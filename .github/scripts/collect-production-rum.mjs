import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DATASET = "rumWebVitalsEventsAdaptiveGroups";
export const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const GROUP_LIMIT = 1000;
const PERCENTILES = ["P50", "P75", "P90", "P99"];
export const METRICS = {
  ttfbMs: { quantile: "timeToFirstByte", total: "ttfbTotal", divisor: 1000 },
  fcpMs: { quantile: "firstContentfulPaint", total: "fcpTotal", divisor: 1000 },
  lcpMs: { quantile: "largestContentfulPaint", total: "lcpTotal", divisor: 1000 },
  inpMs: { quantile: "interactionToNextPaint", total: "inpTotal", divisor: 1000 },
  cls: { quantile: "cumulativeLayoutShift", total: "clsTotal", divisor: 1 },
};

function hostOf(value) {
  const host = value
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();
  return /^[a-z0-9.-]+$/.test(host) ? host : null;
}

function configHosts(text, jsonc) {
  const hosts = new Set();
  const pattern = jsonc
    ? /"(pattern|APP_URL)"\s*:\s*"([^"]+)"/g
    : /\b(pattern|APP_URL)\s*=\s*"([^"]+)"/g;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    if (!jsonc && /^\[\[?env\./.test(trimmed)) break;
    for (const [, key, value] of trimmed.matchAll(pattern)) {
      if (key === "APP_URL" && !/^https:\/\//.test(value)) continue;
      const host = hostOf(value);
      if (host) hosts.add(host);
    }
  }
  return hosts;
}

export function appHosts(repo) {
  const owners = new Map();
  const root = join(repo, "apps");
  for (const app of readdirSync(root).sort()) {
    for (const file of ["wrangler.toml", "wrangler.jsonc"]) {
      const path = join(root, app, file);
      if (!existsSync(path)) continue;
      for (const host of configHosts(readFileSync(path, "utf8"), file.endsWith(".jsonc"))) {
        const owner = owners.get(host);
        if (owner && owner !== app) throw new Error(`${host} is claimed by ${owner} and ${app}`);
        owners.set(host, app);
      }
    }
  }
  return owners;
}

export const rumQuery = `query ProductionRum($accountTag: string!, $filter: AccountRumWebVitalsEventsAdaptiveGroupsFilter_InputObject!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      ${DATASET}(filter: $filter, limit: ${GROUP_LIMIT}) {
        count
        avg { sampleInterval }
        sum { visits ${Object.values(METRICS)
          .map((metric) => metric.total)
          .join(" ")} }
        dimensions { requestHost }
        quantiles { ${Object.values(METRICS)
          .flatMap((metric) => PERCENTILES.map((suffix) => `${metric.quantile}${suffix}`))
          .join(" ")} }
      }
    }
  }
}`;

export function rumVariables({ accountTag, since, until, siteTags = [] }) {
  const filter = { datetime_geq: since, datetime_leq: until, bot: 0 };
  if (siteTags.length) filter.siteTag_in = siteTags;
  return { accountTag, filter };
}

function nonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be nonnegative`);
  return value;
}

function metric(group, { quantile, total, divisor }) {
  const sampleCount = nonnegative(group.sum?.[total], `sum.${total}`);
  return {
    sampleCount,
    ...Object.fromEntries(
      PERCENTILES.map((suffix) => {
        const raw = group.quantiles?.[`${quantile}${suffix}`];
        if (raw !== undefined && raw !== null && !Number.isFinite(raw))
          throw new Error(`quantiles.${quantile}${suffix} must be a number`);
        return [
          suffix.toLowerCase(),
          sampleCount === 0 || raw === undefined || raw === null || raw < 0 ? null : raw / divisor,
        ];
      }),
    ),
  };
}

export function productionRumEnvelope({ response, since, until, collectedAt, hosts }) {
  if (response?.errors?.length)
    throw new Error(
      `Cloudflare GraphQL error: ${response.errors.map((e) => e.message).join("; ")}`,
    );
  const accounts = response?.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1)
    throw new Error("Cloudflare GraphQL response must contain exactly one account");
  const groups = accounts[0][DATASET];
  if (!Array.isArray(groups)) throw new Error(`${DATASET} is missing from the response`);
  if (groups.length >= GROUP_LIMIT)
    throw new Error(`${DATASET} reached the ${GROUP_LIMIT} group limit; results are incomplete`);
  const apps = [];
  let excludedHostCount = 0;
  let excludedPageViews = 0;
  for (const group of groups) {
    const host = hostOf(String(group.dimensions?.requestHost ?? ""));
    const pageViews = nonnegative(group.count, "count");
    const app = host ? hosts.get(host) : undefined;
    if (!app) {
      excludedHostCount++;
      excludedPageViews += pageViews;
      continue;
    }
    apps.push({
      app,
      host,
      pageViews,
      visits: nonnegative(group.sum?.visits, "sum.visits"),
      sampleInterval: nonnegative(group.avg?.sampleInterval, "avg.sampleInterval"),
      metrics: Object.fromEntries(
        Object.entries(METRICS).map(([name, definition]) => [name, metric(group, definition)]),
      ),
    });
  }
  apps.sort((a, b) => a.app.localeCompare(b.app) || a.host.localeCompare(b.host));
  return {
    kind: "production-rum",
    format: "aggregate",
    collectedAt,
    source: `cloudflare-graphql:${DATASET}`,
    window: { since, until, inclusive: true },
    sampling:
      "Cloudflare Web Analytics adaptive sampling; pageViews and sampleCount are Cloudflare estimates, sampleInterval is the average sampling interval; bot traffic excluded",
    privacy:
      "Aggregates grouped by request host only; no paths, query strings, referrers, countries, user agents, or user identifiers are requested",
    apps,
    excludedHostCount,
    excludedPageViews,
  };
}

function isoArgument(value, label) {
  if (typeof value !== "string" || !/T.*Z$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error(`${label} must be a UTC ISO timestamp`);
  return new Date(Date.parse(value)).toISOString().replace(/\.000Z$/, "Z");
}

export async function run(
  args = process.argv.slice(2),
  { env = process.env, fetchImpl = fetch, now = () => new Date() } = {},
) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]?.slice(2);
    if (
      !args[index]?.startsWith("--") ||
      !["since", "until", "output", "repo"].includes(name) ||
      !args[index + 1] ||
      Object.hasOwn(options, name)
    )
      throw new Error(`Invalid or duplicate argument: ${args[index]}`);
    options[name] = args[index + 1];
  }
  if (!options.output) throw new Error("--output is required");
  const since = isoArgument(options.since, "--since");
  const until = isoArgument(options.until, "--until");
  if (Date.parse(since) > Date.parse(until)) throw new Error("--since must not be after --until");
  const token = env.CLOUDFLARE_RUM_API_TOKEN;
  const accountTag = env.CLOUDFLARE_RUM_ACCOUNT_ID;
  if (!token || !accountTag)
    throw new Error("CLOUDFLARE_RUM_API_TOKEN and CLOUDFLARE_RUM_ACCOUNT_ID are required");
  const siteTags = (env.CLOUDFLARE_RUM_SITE_TAGS ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const hosts = appHosts(resolve(options.repo ?? process.cwd()));
  const response = await fetchImpl(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "gdgjp-engineering-health",
    },
    body: JSON.stringify({
      query: rumQuery,
      variables: rumVariables({ accountTag, since, until, siteTags }),
    }),
  });
  if (!response.ok) throw new Error(`Cloudflare GraphQL returned HTTP ${response.status}`);
  const envelope = productionRumEnvelope({
    response: await response.json(),
    since,
    until,
    collectedAt: now().toISOString(),
    hosts,
  });
  const destination = resolve(options.output);
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx" });
  renameSync(temporary, destination);
  return envelope;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

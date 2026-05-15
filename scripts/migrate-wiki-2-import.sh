#!/usr/bin/env bash
# migrate-wiki-2-import.sh  —  run while logged into the NEW gdgjp Cloudflare
#                              account (gdgjp-developers@googlegroups.com).
#
# Imports the resources exported by migrate-wiki-1-export.sh, patches
# wiki/wrangler.toml, and (optionally) deploys the Worker.
#
# What it does:
#   1. Verify prerequisites (wrangler, jq, pnpm)
#   2. Confirm the new wrangler login and collect the new account ID
#   3. Create D1 database (gdgjp-wiki-db), import dump, patch wrangler.toml
#   4. Create R2 bucket (gdgjp-wiki-storage); prints rclone sync instructions
#   5. Create Queues (gdgjp-wiki-translation-jobs, gdgjp-wiki-ingestion-jobs)
#   6. Create Vectorize index (gdgjp-wiki-pages, 1024-dim, cosine)
#   7. Build and deploy the Worker
#   8. Print remaining manual steps (secrets, DNS, Firebase)
#
# Requirements:  wrangler >= 3.x, jq, pnpm
#                rclone (optional, for R2 sync — brew install rclone)
#
# Usage (after migrate-wiki-1-export.sh and wrangler re-login):
#   cd /path/to/gdgjp
#   bash scripts/migrate-wiki-2-import.sh

set -eo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${YELLOW}=== $* ===${NC}"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${REPO_ROOT}/.wiki-migration-backup"
WRANGLER_TOML="${REPO_ROOT}/wiki/wrangler.toml"

OLD_DB_NAME="gdgoc-wiki-production-db"
OLD_R2_BUCKET="gdgoc-wiki-production-storage"

NEW_DB_NAME="gdgjp-wiki-db"
NEW_R2_BUCKET="gdgjp-wiki-storage"
NEW_VECTORIZE_INDEX="gdgjp-wiki-pages"
NEW_TRANSLATION_QUEUE="gdgjp-wiki-translation-jobs"
NEW_INGESTION_QUEUE="gdgjp-wiki-ingestion-jobs"
NEW_WORKER_NAME="gdgjp-wiki"

# ─────────────────────────────────────────────────────────────────────────────
step "1. Prerequisites"
# ─────────────────────────────────────────────────────────────────────────────

for cmd in wrangler jq pnpm; do
  command -v "$cmd" &>/dev/null || die "'$cmd' is not installed."
  ok "$cmd: $(command -v "$cmd")"
done

[ -d "$BACKUP_DIR" ] || die "Backup directory not found: $BACKUP_DIR — run migrate-wiki-1-export.sh first."
ok "Backup directory: $BACKUP_DIR"

HAS_RCLONE=0
if command -v rclone &>/dev/null; then
  ok "rclone: $(command -v rclone)"
  HAS_RCLONE=1
else
  warn "'rclone' not found — R2 sync instructions will be printed but not run automatically."
fi

# ─────────────────────────────────────────────────────────────────────────────
step "2. Confirm new account"
# ─────────────────────────────────────────────────────────────────────────────

info "Current wrangler identity:"
wrangler whoami 2>&1 | tee "$BACKUP_DIR/whoami-new.txt"

NEW_ACCOUNT_ID="$(wrangler whoami --json 2>/dev/null | jq -r '.account_id // empty' || true)"
if [ -z "$NEW_ACCOUNT_ID" ]; then
  warn "Could not auto-detect account ID. Run 'wrangler accounts list' to find it."
  read -rp "  Enter the NEW account ID: " NEW_ACCOUNT_ID
fi
[ -z "$NEW_ACCOUNT_ID" ] && die "New account ID is required."

OLD_ACCOUNT_ID="$(cat "$BACKUP_DIR/old-account-id.txt" 2>/dev/null || true)"
if [ -n "$OLD_ACCOUNT_ID" ] && [ "$OLD_ACCOUNT_ID" = "$NEW_ACCOUNT_ID" ]; then
  die "New account ID matches the old one ($OLD_ACCOUNT_ID). Re-login with 'wrangler logout && wrangler login'."
fi

echo "$NEW_ACCOUNT_ID" > "$BACKUP_DIR/new-account-id.txt"
ok "New account ID: $NEW_ACCOUNT_ID"

# ─────────────────────────────────────────────────────────────────────────────
step "3. Create D1 database, import data, patch wrangler.toml"
# ─────────────────────────────────────────────────────────────────────────────

DUMP_FILE="${BACKUP_DIR}/${OLD_DB_NAME}.sql"
if [ ! -f "$DUMP_FILE" ]; then
  warn "No D1 dump found at $DUMP_FILE — skipping D1 import."
else
  info "Creating D1 database: $NEW_DB_NAME..."
  CREATE_JSON="$(wrangler d1 create "$NEW_DB_NAME" --json 2>/dev/null || true)"
  NEW_DB_ID="$(echo "$CREATE_JSON" | jq -r '.uuid // .id // empty' 2>/dev/null || true)"

  if [ -z "$NEW_DB_ID" ]; then
    warn "Could not parse new DB ID from 'wrangler d1 create' output."
    info "Run 'wrangler d1 list' to find it."
    read -rp "  Enter new database_id for $NEW_DB_NAME: " NEW_DB_ID
  fi
  [ -z "$NEW_DB_ID" ] && die "database_id for $NEW_DB_NAME is required."
  ok "$NEW_DB_NAME created → $NEW_DB_ID"

  info "Importing $DUMP_FILE into $NEW_DB_NAME..."
  wrangler d1 execute "$NEW_DB_NAME" \
    --file "$DUMP_FILE" \
    --remote \
    2>&1 | tee "${BACKUP_DIR}/${NEW_DB_NAME}-import.log" || {
    warn "Import failed — see ${BACKUP_DIR}/${NEW_DB_NAME}-import.log"
  }
  ok "$NEW_DB_NAME imported."

  sed -i.bak "s|database_id = \"\"|database_id = \"${NEW_DB_ID}\"|" "$WRANGLER_TOML"
  ok "database_id patched in $WRANGLER_TOML"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "4. Create R2 bucket"
# ─────────────────────────────────────────────────────────────────────────────

info "Creating R2 bucket: $NEW_R2_BUCKET..."
wrangler r2 bucket create "$NEW_R2_BUCKET" 2>&1 || warn "Bucket may already exist — continuing."
ok "Bucket $NEW_R2_BUCKET ready in new account."

cat <<EOF

  -- R2 data sync -------------------------------------------------------

  Sync the bucket contents from the old account using rclone.

  Configure two rclone remotes (run: rclone config):
    cf-old   →  Cloudflare R2, old account credentials
    cf-new   →  Cloudflare R2, new account credentials

  Get S3-compatible credentials from each account's dashboard:
    R2 → Manage R2 API Tokens → Create API Token

  Then run:
    rclone sync cf-old:${OLD_R2_BUCKET} cf-new:${NEW_R2_BUCKET} --progress

EOF

if [ "$HAS_RCLONE" -eq 1 ]; then
  read -rp "  Press Enter once rclone sync is complete (or Ctrl-C to stop here): "
else
  warn "rclone not installed — sync manually before running the Worker in production."
fi

# ─────────────────────────────────────────────────────────────────────────────
step "5. Create Queues"
# ─────────────────────────────────────────────────────────────────────────────

create_queue() {
  local NAME="$1"
  info "Creating queue: $NAME..."
  wrangler queues create "$NAME" 2>&1 || warn "Queue $NAME may already exist — continuing."
}
create_queue "$NEW_TRANSLATION_QUEUE"
create_queue "$NEW_INGESTION_QUEUE"
ok "Queues ready (note: in-flight messages from the old account are NOT migrated)."

# ─────────────────────────────────────────────────────────────────────────────
step "6. Create Vectorize index"
# ─────────────────────────────────────────────────────────────────────────────

info "Creating Vectorize index: $NEW_VECTORIZE_INDEX (1024 dim, cosine)..."
wrangler vectorize create "$NEW_VECTORIZE_INDEX" \
  --dimensions 1024 \
  --metric cosine \
  2>&1 || warn "Index may already exist — continuing."
ok "Vectorize index ready."
warn "Vectors are NOT migrated. Re-embed pages by triggering the ingestion pipeline."

# ─────────────────────────────────────────────────────────────────────────────
step "7. Build and deploy Worker"
# ─────────────────────────────────────────────────────────────────────────────

cd "$REPO_ROOT"

info "Building @gdgjp/wiki..."
pnpm --filter @gdgjp/wiki build 2>&1 | tee "${BACKUP_DIR}/build.log"
ok "Build complete."

info "Deploying $NEW_WORKER_NAME..."
pnpm --filter @gdgjp/wiki deploy 2>&1 | tee "${BACKUP_DIR}/deploy.log" || {
  warn "Deploy failed — see ${BACKUP_DIR}/deploy.log"
}

# ─────────────────────────────────────────────────────────────────────────────
step "8. Remaining manual steps"
# ─────────────────────────────────────────────────────────────────────────────

SECRETS_FILE="${BACKUP_DIR}/worker-secrets.txt"

cat <<EOF

  Worker is deployed. Complete the following manually:

  A. Re-set Worker secrets
     Secret names exported to: ${SECRETS_FILE}
     For each secret name listed there:
       wrangler secret put <KEY> --name ${NEW_WORKER_NAME}

     Expected secrets:
       BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
       GEMINI_API_KEY, RESEND_API_KEY, WIKI_DISCORD_SECRET,
       FCM_SERVICE_ACCOUNT_JSON, DISCORD_BOT_TOKEN

  B. DNS — wiki.gdgs.jp must resolve to the new Worker
     The wiki/wrangler.toml route binding (wiki.gdgs.jp/*) will attach
     once the zone gdgs.jp is in the new account. If you have not yet
     transferred gdgs.jp, do so via the dashboard.

  C. Firebase (push notifications)
     The Firebase project (gdgoc-wiki) is NOT migrated. Either:
       - keep the same Firebase project (no action needed), or
       - create a new project and update FIREBASE_* in wiki/wrangler.toml
         plus re-upload FCM_SERVICE_ACCOUNT_JSON as a secret.

  D. Re-index Vectorize
     Trigger the ingestion pipeline for all pages to re-embed them
     into the new gdgjp-wiki-pages index.

  Old account ID : ${OLD_ACCOUNT_ID:-(unknown)}
  New account ID : ${NEW_ACCOUNT_ID}
  Backup files   : ${BACKUP_DIR}/

EOF

ok "Import complete."

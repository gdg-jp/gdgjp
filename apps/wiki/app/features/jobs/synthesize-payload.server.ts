import { type SQL, sql } from "drizzle-orm";

export function mergeSynthesizePayload(
  existing: SQL,
  incoming: SQL,
  { prependRequests = false } = {},
): SQL {
  const valid = (payload: SQL) =>
    sql`CASE WHEN json_valid(${payload}) THEN ${payload} ELSE '{}' END`;
  const array = (payload: SQL, field: string) => {
    const path = `$.${field}`;
    return sql`CASE WHEN json_type(${valid(payload)}, ${path}) = 'array'
      THEN json_extract(${valid(payload)}, ${path}) ELSE '[]' END`;
  };
  const union = (field: string) => sql`(
    SELECT json_group_array(value) FROM (
      SELECT value FROM json_each(${array(existing, field)})
      UNION ALL
      SELECT value FROM json_each(${array(incoming, field)})
       WHERE value NOT IN (SELECT value FROM json_each(${array(existing, field)}))
    )
  )`;
  const requestInputs = prependRequests ? [incoming, existing] : [existing, incoming];
  const requests = sql`(
    SELECT json_group_array(json(value)) FROM (
      SELECT value FROM json_each(${array(requestInputs[0], "requests")})
      UNION ALL SELECT value FROM json_each(${array(requestInputs[1], "requests")})
    )
  )`;
  return sql`json_object(
    'sourceIds', json(${union("sourceIds")}),
    'documentIds', json(${union("documentIds")}),
    'requests', json(${requests})
  )`;
}

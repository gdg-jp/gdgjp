import { DatabaseSync } from "node:sqlite";
import { splitStatements } from "./lib.mjs";

export function rehearseImport(sql, label) {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    for (const statement of splitStatements(sql)) {
      if (/^PRAGMA\s+defer_foreign_keys/i.test(statement)) continue;
      try {
        database.exec(statement);
      } catch (error) {
        throw new Error(`${label}: ${error.message} in ${statement.slice(0, 160)}`);
      }
    }
  } finally {
    database.close();
  }
}

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

/** Runs production store SQL against real SQLite, with async yields to force CAS contention. */
export function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../drizzle/0000_special_steel_serpent.sql", import.meta.url), "utf8"));
  const stats = { conflicts: 0 };
  const prepare = (sql: string) => {
    const make = (values: (string | number | null)[]) => ({
      bind: (...next: (string | number | null)[]) => make(next),
      first: async () => {
        const value = sqlite.prepare(sql).get(...values) ?? null;
        await Promise.resolve();
        return value;
      },
      run: async () => {
        await Promise.resolve();
        const result = sqlite.prepare(sql).run(...values);
        const changes = Number(result.changes);
        if (sql.startsWith("UPDATE game_rooms") && changes === 0) stats.conflicts++;
        return { success: true, meta: { changes }, results: [] };
      },
    });
    return make([]);
  };
  const binding = {
    prepare,
    batch: async (statements: { run: () => Promise<unknown> }[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { binding, sqlite, stats };
}

/**
 * The one place a database driver is named.
 *
 * `PgVectorIndex` speaks SQL through `SqlClient` and nothing else. Behind it is
 * always a Postgres server at `DATABASE_URL`, reached through `Bun.sql`, the
 * client built into the runtime — in development and in the tests as much as
 * in production. There was once an embedded second driver (PGlite) for the
 * no-install path; it gave every machine its own private corpus, so the index
 * is a real server everywhere now.
 *
 * The driver hands back its own types for some columns (`Date` for timestamps,
 * a string for `vector`, a numeric string for `avg()`); turning those into
 * plain values is the store's job, so nothing exported from this package
 * carries a driver type (`docs/architecture.md`).
 *
 * Deliberately tiny: parameterized text in, rows out, one transaction shape.
 * Anything cleverer belongs in the SQL.
 */

import { SQL } from "bun";

/** Runs statements. Inside a transaction this is all there is. */
export interface SqlExecutor {
  /** `$1`-style placeholders. One statement per call: the extended protocol allows no more. */
  query<T>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface SqlClient extends SqlExecutor {
  /** `fn` runs between BEGIN and COMMIT. A throw rolls back and is rethrown. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  /** Idempotent. */
  close(): Promise<void>;
}

/**
 * A Postgres server, through the client built into Bun. The server must have
 * the `vector` extension available (`CREATE EXTENSION` runs at open).
 * Connections are pooled and lazy: nothing is dialled until the first query.
 */
export function openBunSql(url: string): SqlClient {
  const sql = new SQL(url);

  const executor = (conn: SQL): SqlExecutor => ({
    async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      return await conn.unsafe<T[]>(text, [...params]);
    },
  });

  let closed = false;
  return {
    ...executor(sql),
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      // `begin` resolves to whatever the callback returns, but its declared
      // result type is a projection of that; capturing the value sidesteps
      // the cast.
      let out!: T;
      await sql.begin(async (tx) => {
        out = await fn(executor(tx));
      });
      return out;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await sql.close();
    },
  };
}

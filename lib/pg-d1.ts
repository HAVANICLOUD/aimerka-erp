import postgres from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';

// Adaptador mínimo con la forma de D1 (prepare/bind/first/all/run/batch) sobre
// Postgres (Supabase). Mantiene intacta la lógica de store.ts: `batch` corre en
// una sola transacción, igual que D1, así que el candado de revisión
// (`UPDATE … WHERE revision=?` + guardas EXISTS) se comporta igual.
//
// Workers no permite reutilizar sockets entre solicitudes: cada solicitud abre
// su propia conexión (perezosa) y se cierra al terminar.

type Scope = { url: string; sql?: ReturnType<typeof postgres> };
const scope = new AsyncLocalStorage<Scope>();

export async function runWithPostgres<T>(url: string | undefined, ctx: { waitUntil(p: Promise<unknown>): void }, run: () => Promise<T>): Promise<T> {
  if (!url) return run();
  const current: Scope = { url };
  try {
    return await scope.run(current, run);
  } finally {
    if (current.sql) ctx.waitUntil(current.sql.end({ timeout: 5 }).catch(() => {}));
  }
}

export function postgresDatabase(): PgDatabase | null {
  const current = scope.getStore();
  if (!current) return null;
  return new PgDatabase(() => {
    current.sql ??= postgres(current.url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
    return current.sql;
  });
}

// SQLite → Postgres: placeholders `?` → `$n` e `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`.
export function translate(text: string) {
  let n = 0, sql = text.replace(/\?/g, () => '$' + (++n));
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql)) sql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO') + ' ON CONFLICT DO NOTHING';
  return sql;
}

type Runner = { unsafe(query: string, params?: any[]): Promise<any> };

class PgStatement {
  constructor(private db: PgDatabase, readonly text: string, readonly params: any[] = []) {}
  bind(...params: any[]) { return new PgStatement(this.db, this.text, params); }
  async exec(runner: Runner) {
    const rows = await runner.unsafe(translate(this.text), this.params);
    return { results: [...rows], success: true, meta: { changes: rows.count ?? 0 } };
  }
  async all<T = any>() { return (await this.exec(this.db.sql())) as { results: T[]; success: boolean; meta: { changes: number } }; }
  async first<T = any>(): Promise<T | null> { return ((await this.all<T>()).results[0] ?? null) as T | null; }
  async run() { return this.all(); }
}

export class PgDatabase {
  constructor(readonly sql: () => ReturnType<typeof postgres>) {}
  prepare(text: string) { return new PgStatement(this, text); }
  async batch(statements: PgStatement[]) {
    return this.sql().begin(async tx => {
      const out = [];
      for (const statement of statements) out.push(await statement.exec(tx as unknown as Runner));
      return out;
    }) as Promise<{ results: any[]; success: boolean; meta: { changes: number } }[]>;
  }
}

/**
 * Penyimpanan Daily Spin, terpisah dari tabel Ponder supaya fitur ini tidak memicu indexing ulang.
 * PostgreSQL (DATABASE_URL, schema "rivl_rewards") di server; PGlite di indexer/.ponder/rewards saat lokal.
 * Semua bilangan besar disimpan sebagai numeric/teks desimal.
 */
import { rewardsEnv } from "./env";

export type Row = Record<string, unknown>;
export type Db = { query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]> };

const MIGRATION = `
create schema if not exists rivl_rewards;
create table if not exists rivl_rewards.settings (id int primary key, data text not null, updated_at bigint not null);
create table if not exists rivl_rewards.cursor (id int primary key, token text not null, last_block numeric not null, last_ts bigint not null);
create table if not exists rivl_rewards.balance (account text primary key, balance numeric not null);
create table if not exists rivl_rewards.balance_change (
  block numeric not null, log_index int not null, account text not null, ts bigint not null, balance_after numeric not null,
  primary key (block, log_index, account));
create index if not exists balance_change_account on rivl_rewards.balance_change (account, ts);
create table if not exists rivl_rewards.spin (
  account text not null, day text not null, week text not null, created_at bigint not null,
  roll int not null, rolled text not null, prize text not null, xp int not null default 0,
  token text, amount numeric, cosmetic text, vouchers int not null default 0, pity boolean not null default false,
  odds text not null, primary key (account, day));
create index if not exists spin_week on rivl_rewards.spin (week, prize);
create table if not exists rivl_rewards.inventory (account text not null, cosmetic text not null, acquired_at bigint not null,
  primary key (account, cosmetic));
create table if not exists rivl_rewards.equipped (account text primary key, frame text, badge text, title text, updated_at bigint not null);
create table if not exists rivl_rewards.voucher_use (duel_id text primary key, account text not null, token text not null,
  fee numeric not null, used_at bigint not null);
create table if not exists rivl_rewards.epoch (epoch int primary key, root text not null, tree text not null, totals text not null,
  created_at bigint not null);
`;

let ready: Promise<Db> | undefined;

async function open(): Promise<Db> {
  if (rewardsEnv.databaseUrl) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: rewardsEnv.databaseUrl, max: 4 });
    await pool.query(MIGRATION);
    return { query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = new PGlite(rewardsEnv.dataDir);
  await lite.exec(MIGRATION);
  return { query: async (sql, params) => (await lite.query(sql, params as unknown[])).rows as never };
}

/** Satu koneksi bersama per proses (Ponder dev memuat ulang file API, jadi disimpan di globalThis). */
export function store(): Promise<Db> {
  const g = globalThis as { __rivlRewardsDb?: Promise<Db> };
  ready ??= g.__rivlRewardsDb ??= open().catch((err) => {
    g.__rivlRewardsDb = undefined;
    ready = undefined;
    throw err;
  });
  return ready;
}

/** Jalankan fn satu per satu (spin & penulisan lain yang bergantung pada batas mingguan). */
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { __rivlRewardsLock?: Promise<unknown> };
  const run = (g.__rivlRewardsLock ?? Promise.resolve()).then(fn, fn);
  g.__rivlRewardsLock = run.catch(() => {});
  return run;
}

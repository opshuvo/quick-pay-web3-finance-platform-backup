import { SQL } from 'bun'
import { config } from './env'

/** Null when DATABASE_URL is not configured; endpoints then answer 503 `database_not_configured`. */
export const sql: SQL | null = config.databaseUrl ? new SQL(config.databaseUrl) : null

export function requireDb(): SQL {
  if (!sql) throw new HttpError(503, 'database_not_configured', 'The history database is not configured on this server.')
  return sql
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function migrate(): Promise<void> {
  if (!sql) return
  await sql`
    create table if not exists wallets (
      address text primary key,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_activity timestamptz not null default now(),
      -- scanned interval is [oldest_scanned, newest_scanned]; empty when oldest = newest + 1
      newest_scanned bigint not null,
      oldest_scanned bigint not null,
      last_error text,
      last_error_at timestamptz
    )`
  await sql`
    create table if not exists transfers (
      tx_hash text not null,
      log_index integer not null,
      block_number bigint not null,
      block_time timestamptz not null,
      from_addr text not null,
      to_addr text not null,
      token text not null,
      amount numeric(78,0) not null,
      primary key (tx_hash, log_index)
    )`
  await sql`create index if not exists transfers_from_idx on transfers (from_addr, block_number desc)`
  await sql`create index if not exists transfers_to_idx on transfers (to_addr, block_number desc)`
  await sql`
    create table if not exists payment_requests (
      id text primary key,
      recipient text not null,
      amount numeric(78,0) not null check (amount > 0),
      description text not null default '',
      expires_at timestamptz,
      created_at timestamptz not null default now(),
      status text not null default 'unpaid' check (status in ('unpaid','paid','cancelled')),
      paid_tx_hash text unique,
      paid_by text,
      paid_at timestamptz,
      cancelled_at timestamptz
    )`
  await sql`
    create table if not exists defi_activity (
      id bigserial primary key,
      kind text not null check (kind in ('swap','bridge')),
      wallet text not null,
      source_chain_id bigint not null,
      destination_chain_id bigint not null,
      source_tx_hash text not null,
      destination_tx_hash text,
      token_in text not null,
      token_out text,
      recipient text,
      amount_in numeric(78,0) not null,
      amount_out numeric(78,0),
      expected_amount_out numeric(78,0),
      fee_amount numeric(78,0),
      fee_token text,
      status text not null check (status in ('confirmed','pending','filled','expired','refunded')),
      destination_verified boolean not null default false,
      block_time timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (source_chain_id, source_tx_hash)
    )`
  for (const column of ['token_in_symbol text', 'token_out_symbol text', 'token_in_decimals integer', 'token_out_decimals integer']) {
    await sql.unsafe(`alter table defi_activity add column if not exists ${column}`)
  }
  await sql`create index if not exists defi_activity_wallet_idx on defi_activity (wallet, block_time desc)`
  await sql`create index if not exists defi_activity_dest_idx on defi_activity (destination_tx_hash)`
  await sql`create index if not exists payment_requests_recipient_idx on payment_requests (recipient, created_at desc)`
}

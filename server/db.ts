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
  // Chain scoping: every record carries its chain id (Arc Mainnet 5042). Additive and idempotent, so existing rows are kept.
  await sql`alter table wallets add column if not exists chain_id bigint not null default 5042`
  await sql`alter table transfers add column if not exists chain_id bigint not null default 5042`
  await sql`create unique index if not exists transfers_chain_tx_log_uidx on transfers (chain_id, tx_hash, log_index)`
  await sql`create index if not exists transfers_chain_from_idx on transfers (chain_id, from_addr, block_number desc)`
  await sql`create index if not exists transfers_chain_to_idx on transfers (chain_id, to_addr, block_number desc)`
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
  // Verified facts about each transaction the indexer looked at (sender, target contract, receipt status).
  await sql`
    create table if not exists tx_meta (
      chain_id bigint not null,
      tx_hash text not null,
      block_number bigint not null,
      tx_from text not null,
      tx_to text,
      status text not null check (status in ('success','reverted')),
      checked_at timestamptz not null default now(),
      primary key (chain_id, tx_hash)
    )`
  // Durable work list: survives restarts, retried with backoff, never duplicated.
  await sql`
    create table if not exists tx_queue (
      chain_id bigint not null,
      tx_hash text not null,
      wallet text not null,
      attempts integer not null default 0,
      last_error text,
      next_attempt_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      primary key (chain_id, tx_hash, wallet)
    )`
  await sql`create index if not exists tx_queue_due_idx on tx_queue (chain_id, next_attempt_at, created_at)`
  // Rows stored before the queue existed: verify the registered wallets' outgoing transactions too. Idempotent.
  await sql`
    insert into tx_queue (chain_id, tx_hash, wallet)
    select distinct t.chain_id, t.tx_hash, w.address from transfers t
      join wallets w on w.address = t.from_addr
        or (w.address = t.to_addr and t.from_addr = any(array[
          '0x8366a39cc670b4001a1121b8f6a443a643e40951', '0x8702463e73f74d0b6765abceb314ef07acb92650',
          '0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77', '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
          '0x9b4a302a548c7e313c2b74c461db7b84d3074a84']::text[]))
    where not exists (select 1 from tx_meta m where m.chain_id = t.chain_id and m.tx_hash = t.tx_hash)
    on conflict do nothing`
  await sql`create index if not exists defi_activity_wallet_idx on defi_activity (wallet, block_time desc)`
  await sql`create index if not exists defi_activity_dest_idx on defi_activity (destination_tx_hash)`
  await sql`create index if not exists payment_requests_recipient_idx on payment_requests (recipient, created_at desc)`
}

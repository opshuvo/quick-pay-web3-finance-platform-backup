/**
 * Known protocol contracts on Arc Mainnet, used only to LABEL already-indexed USDC transfers.
 * A transfer whose counterparty is one of these is shown as a Swap or Bridge. Labelling is
 * best-effort: swaps routed through a v3 pool and inbound bridge fills are not recognised.
 */
export const SWAP_COUNTERPARTIES = [
  '0x8366a39cc670b4001a1121b8f6a443a643e40951', // Uniswap v4 PoolManager
  '0x8702463e73f74d0b6765abceb314ef07acb92650', // Uniswap Universal Router 2.1.2
  '0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77', // Uniswap SwapRouter02
  '0x1f7d7550b1b028f7571e69a784071f0205fd2efa', // Uniswap v2 Router02
] as const

export const BRIDGE_COUNTERPARTIES = [
  '0x9b4a302a548c7e313c2b74c461db7b84d3074a84', // Across spoke pool entry point on Arc
] as const

const list = (values: readonly string[]) => `array[${values.map((v) => `'${v}'`).join(',')}]::text[]`

/** SQL expressions (constants only, no user input) shared by history and analytics queries. */
export const COUNTERPARTY_SQL = (address: string) => `(case when t.from_addr = ${address} then t.to_addr else t.from_addr end)`

export const TYPE_SQL = (address: string) =>
  `(case when r.id is not null then 'request_payment'
        when exists (select 1 from defi_activity d where d.kind = 'swap' and d.source_chain_id = 5042 and d.source_tx_hash = t.tx_hash) then 'swap'
        when exists (select 1 from defi_activity d where d.kind = 'bridge' and ((d.source_chain_id = 5042 and d.source_tx_hash = t.tx_hash) or (d.destination_chain_id = 5042 and d.destination_tx_hash = t.tx_hash))) then 'bridge'
        when exists (select 1 from tx_meta m where m.chain_id = 5042 and m.tx_hash = t.tx_hash and m.status = 'success' and m.tx_from = ${address} and m.tx_to = any(${list(SWAP_COUNTERPARTIES)})) then 'swap'
        when exists (select 1 from tx_meta m where m.chain_id = 5042 and m.tx_hash = t.tx_hash and m.status = 'success' and m.tx_from = ${address} and m.tx_to = any(${list(BRIDGE_COUNTERPARTIES)})) then 'bridge'
        when ${COUNTERPARTY_SQL(address)} = any(${list(SWAP_COUNTERPARTIES)}) then 'swap'
        when ${COUNTERPARTY_SQL(address)} = any(${list(BRIDGE_COUNTERPARTIES)}) then 'bridge'
        else 'transfer' end)`

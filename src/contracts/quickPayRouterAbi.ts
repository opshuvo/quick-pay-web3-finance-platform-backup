/** Minimal ABI for contracts/QuickPayRouter.sol (payments and the reads the app needs). */
export const quickPayRouterAbi = [
  {
    type: 'function',
    name: 'payTo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'reference_', type: 'bytes32' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'usdc', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  {
    type: 'event',
    name: 'PaymentSent',
    inputs: [
      { name: 'payer', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'reference_', type: 'bytes32', indexed: true },
    ],
  },
] as const

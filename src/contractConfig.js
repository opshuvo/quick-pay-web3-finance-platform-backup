// src/contractConfig.js

export const QUICK_PAY_ROUTER_ADDRESS = "0x1593C6fdEAB15228c90da354913a919fDA08b7E4";

export const QUICK_PAY_ROUTER_ABI = [
  // Paste your full copied ABI JSON array here, for example:
  {
    "inputs": [
      { "internalType": "address", "name": "recipient", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "internalType": "bytes32", "name": "reference_", "type": "bytes32" }
    ],
    "name": "payTo",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  // ... rest of your ABI items from Remix
];

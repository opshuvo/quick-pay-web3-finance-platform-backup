import { ArrowLeftRight, Download, Link2, QrCode, ReceiptText, ScanLine, Send, Split, type LucideIcon } from 'lucide-react'

/** Landing page copy. Every line describes something Quick Pay really does; no figures, no invented numbers. */

export interface Feature {
  icon: LucideIcon
  title: string
  text: string
  to: string
}

export const FEATURES: Feature[] = [
  { icon: Send, title: 'Send', text: 'Pay USDC or EURC to any address. You see the amount and the network fee first, then approve it in your own wallet.', to: '/send' },
  { icon: Download, title: 'Receive', text: 'Show a QR code or share your address to get paid in USDC on Arc.', to: '/receive' },
  { icon: ScanLine, title: 'Scan & Pay', text: 'Scan a payment QR code to fill in the details. Nothing is sent until you confirm.', to: '/scan' },
  { icon: Split, title: 'Split Payment', text: 'Divide a bill between friends and see who has paid.', to: '/split' },
  { icon: Link2, title: 'Request Pay', text: 'Create a payment link with an amount and a reference. It shows Paid only after Arc confirms the transfer.', to: '/requests' },
  { icon: ArrowLeftRight, title: 'Swap', text: 'Swap between USDC, EURC and other listed tokens on Arc with a live quote and your own slippage limit.', to: '/swap' },
  { icon: QrCode, title: 'Bridge', text: "Move USDC between Arc and other networks with Across, LI.FI or Circle's own USDC bridge.", to: '/bridge' },
  { icon: ReceiptText, title: 'Transaction History', text: 'A record of your payments, swaps and bridges, each with a link to the Arc explorer.', to: '/history' },
]

export interface Step {
  title: string
  text: string
}

export const STEPS: Step[] = [
  { title: 'Connect your wallet', text: 'Use a browser wallet or WalletConnect. If you are on another network, Quick Pay asks you to switch to Arc Mainnet.' },
  { title: 'Choose what to do', text: 'Send, receive, scan, split, request, swap or bridge from one place.' },
  { title: 'Review and approve', text: 'Check the amount, recipient and network fee. Nothing happens until you approve it in your wallet.' },
  { title: 'Track it on Arc', text: 'Your payment shows as Pending, then Confirmed or Failed, based on the receipt read back from Arc.' },
]

export interface Point {
  title: string
  text: string
}

export const SECURITY: Point[] = [
  { title: 'Non-custodial', text: 'Quick Pay never holds your funds or your keys. Every transaction is signed in your own wallet.' },
  { title: 'Arc Mainnet', text: 'Payments settle in USDC on Arc Mainnet (chain ID 5042). They are real funds and cannot be reversed.' },
  { title: 'Receipts, not promises', text: 'A payment is marked Paid or Confirmed only after its receipt is read back from Arc.' },
  { title: 'Open to inspection', text: 'The USDC contract address is shown below with an explorer link, and the code is on GitHub.' },
]

export const WHY: Point[] = [
  { title: 'One place for payments', text: 'Send, split, request, swap and bridge without switching between apps.' },
  { title: 'One balance for gas', text: 'On Arc, USDC is also the gas token, so you do not need a second token to pay fees.' },
  { title: 'Clear before you sign', text: 'Amounts, recipients and fees are laid out in a review step before your wallet asks you to sign.' },
  { title: 'History you can verify', text: 'Every entry can be checked against Arc through the explorer link.' },
  { title: 'Made for phones and desktops', text: 'The same app works on a phone, a tablet and a wide screen, in light and dark.' },
  { title: 'Your lists stay with you', text: 'Saved payout lists are kept on your own device.' },
]

/** Only https links are rendered, so a mistyped setting can never become a script or an unsafe link. */
export function httpsUrl(value: string | undefined): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  try {
    const url = new URL(text)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

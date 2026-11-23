/*
 *  ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗
 *  ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
 *  ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
 *  ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
 *  ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
 *  ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝
 *
 *  Built with Arc Studio
 *  https://studio.arc.io
 */

import './tracing'
import './console-capture'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider, useTheme } from '@/hooks/useTheme'
import { Splash } from '@/components/Splash'
import { WalletModalMount } from '@/components/WalletModalMount'
import { installShareSync } from '@/lib/share'
import { config } from './config'
import App from './App'
import './index.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
installShareSync()

function Providers() {
  const { theme } = useTheme()
  return (
    <>
      <App />
      <Splash />
      <WalletModalMount />
      <Toaster position="top-center" theme={theme} />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrowserRouter useTransitions={false}>
            <Providers />
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)

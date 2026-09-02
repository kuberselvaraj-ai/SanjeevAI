import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { TRPCProvider } from '@/providers/trpc'
import { Toaster } from '@/components/ui/sonner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <TRPCProvider>
        <App />
        <Toaster />
      </TRPCProvider>
    </HashRouter>
  </StrictMode>,
)

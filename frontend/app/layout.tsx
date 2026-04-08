import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { Sidebar } from '@/components/sidebar'

export const metadata: Metadata = {
  title: 'Administry Research',
  description: 'Analytics & predictive insights for Administry case management data',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Sidebar />
          <main className="ml-56 min-h-screen">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}

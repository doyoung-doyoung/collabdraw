import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CollabDraw — Real-time Collaborative Canvas',
  description: 'Draw together with friends in real time',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

import './globals.css'
import { ReactNode } from 'react'

export const metadata = {
  title: 'AI Decision Flow',
  description: 'Visual AI decision workflows with Inngest and React Flow',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900">
        <div className="min-h-screen">
          {children}
        </div>
      </body>
    </html>
  )
}

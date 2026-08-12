"use client"

import dynamic from 'next/dynamic'
import { useState } from 'react'
import Toolbar from '../components/Toolbar'
import LogsPanel from '../components/LogsPanel'

const FlowCanvas = dynamic(() => import('../components/FlowCanvas'), { ssr: false })

export default function Page() {
  const [logs, setLogs] = useState<any[]>([])

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">AI Decision Flow</h1>
      <div className="flex gap-4">
        <div className="flex-1">
          <Toolbar />
          <FlowCanvas onLogs={(l: any) => setLogs((s) => [...s, ...l])} />
        </div>
        <div className="w-96">
          <LogsPanel logs={logs} />
        </div>
      </div>
    </main>
  )
}

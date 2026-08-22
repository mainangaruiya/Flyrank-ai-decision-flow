"use client"

import { useCallback, useState } from 'react'
import demoGraph from '../samples/demo-graph.json'

export default function Toolbar() {
  // The demo reveals itself over 45s; hide the button on click so it can't be
  // re-triggered mid-reveal and doesn't sit there looking unfinished.
  const [demoStarted, setDemoStarted] = useState(false)

  const addNode = useCallback(() => {
    const ev = new CustomEvent('flow:add-node')
    window.dispatchEvent(ev)
  }, [])

  const loadDemo = useCallback(() => {
    setDemoStarted(true)
    const ev = new CustomEvent('flow:import', { detail: demoGraph })
    window.dispatchEvent(ev)
  }, [])

  const exportGraph = useCallback(() => {
    const ev = new CustomEvent('flow:export')
    window.dispatchEvent(ev)
  }, [])

  const importGraph = useCallback(() => {
    const json = prompt('Paste graph JSON')
    if (!json) return
    try {
      const data = JSON.parse(json)
      const ev = new CustomEvent('flow:import', { detail: data })
      window.dispatchEvent(ev)
    } catch (e) {
      alert('Invalid JSON')
    }
  }, [])

  return (
    <div className="flex gap-2 mb-2">
      {!demoStarted && (
        <button onClick={loadDemo} className="px-3 py-1 bg-purple-600 text-white rounded" title={demoGraph.description}>Load Demo</button>
      )}
      <button onClick={addNode} className="px-3 py-1 bg-blue-600 text-white rounded">Add Decision Node</button>
      <button onClick={exportGraph} className="px-3 py-1 bg-slate-200 rounded">Export</button>
      <button onClick={importGraph} className="px-3 py-1 bg-slate-200 rounded">Import</button>
    </div>
  )
}

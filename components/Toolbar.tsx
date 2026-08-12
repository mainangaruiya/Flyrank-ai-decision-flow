"use client"

import { useCallback } from 'react'

export default function Toolbar() {
  const addNode = useCallback(() => {
    const ev = new CustomEvent('flow:add-node')
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
      <button onClick={addNode} className="px-3 py-1 bg-blue-600 text-white rounded">Add Decision Node</button>
      <button onClick={exportGraph} className="px-3 py-1 bg-slate-200 rounded">Export</button>
      <button onClick={importGraph} className="px-3 py-1 bg-slate-200 rounded">Import</button>
    </div>
  )
}

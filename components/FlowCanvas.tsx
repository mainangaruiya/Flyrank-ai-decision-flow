'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { ReactFlow, Background, Controls, addEdge, applyNodeChanges, applyEdgeChanges } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import DecisionNode from './nodes/DecisionNode'

const nodeTypes = { decision: DecisionNode }

// Pasted graphs only carry a label, but React Flow needs a sourceHandle to place
// the edge, and an id to render it at all. Fill both in so hand-written JSON works.
function normalizeGraph(d: any) {
  const nodes = (d.nodes || []).map((n: any, i: number) => ({
    type: 'decision',
    position: { x: 50 + i * 40, y: 50 + i * 40 },
    ...n,
    data: { prompt: '', ...(n.data || {}) },
  }))

  const edges = (d.edges || []).map((e: any, i: number) => {
    const label = String(e.label ?? '').toUpperCase()
    return {
      ...e,
      id: e.id || `e_${i}_${e.source}_${e.target}`,
      label,
      sourceHandle: e.sourceHandle ?? (label === 'NO' ? 'NO' : 'YES'),
    }
  })

  return { nodes, edges }
}

export default function FlowCanvas({ onLogs }: { onLogs?: (l: any[]) => void }) {
  const [nodes, setNodes] = useState<any[]>([])
  const [edges, setEdges] = useState<any[]>([])
  // An imported graph can carry the input it was designed for; otherwise use this.
  const [runInput, setRunInput] = useState<any>({ value: 42 })
  // A slow reveal looks like a hung page without a progress line.
  const [progress, setProgress] = useState<{ shown: number; total: number } | null>(null)
  const idRef = useRef(1)
  const flowRef = useRef<any>(null)
  const staggerRef = useRef<any>(null)

  // Cancel any in-flight staggered load, so clicking twice restarts cleanly
  // instead of interleaving two sequences.
  const cancelStagger = () => {
    if (staggerRef.current) {
      clearInterval(staggerRef.current)
      staggerRef.current = null
    }
  }
  useEffect(() => () => cancelStagger(), [])

  const refit = () => setTimeout(() => flowRef.current?.fitView({ padding: 0.15, duration: 200 }), 30)

  useEffect(() => {
    const onAdd = () => {
      const id = `n_${idRef.current++}`
      setNodes((ns) => [...ns, { id, position: { x: 50 + ns.length * 20, y: 50 + ns.length * 20 }, data: { prompt: 'Is value over threshold?' }, type: 'decision' }])
    }
    const onExport = () => {
      const data = { nodes, edges }
      navigator.clipboard?.writeText(JSON.stringify(data, null, 2))
      alert('Graph copied to clipboard')
    }
    const onImport = (e: any) => {
      const d = e.detail
      if (!d?.nodes) return

      cancelStagger()
      const g = normalizeGraph(d)
      if (d.input && typeof d.input === 'object') setRunInput(d.input)
      // Keep generated ids clear of the imported ones, or Add Node reuses n_1.
      const highest = Math.max(0, ...g.nodes.map((n: any) => parseInt(String(n.id).replace(/\D/g, ''), 10) || 0))
      idRef.current = highest + 1

      // Reveal the graph one node at a time - that is what makes the demo
      // readable. Each edge appears with the later of its two endpoints.
      // totalMs spreads the whole reveal evenly over that duration, so the pacing
      // holds if nodes are added or removed; staggerMs sets the gap directly.
      const count = g.nodes.length
      const totalMs = Number(d.totalMs) || 0
      const staggerMs = totalMs > 0
        ? (count > 1 ? totalMs / (count - 1) : 0)
        : Number(d.staggerMs) || 0

      if (staggerMs <= 0) {
        setNodes(g.nodes)
        setEdges(g.edges)
        setProgress(null)
        // fitView only applies on mount, so a big imported graph lands off-screen.
        refit()
        return
      }

      setNodes([])
      setEdges([])
      let shown = 0
      const step = () => {
        shown++
        const visible = g.nodes.slice(0, shown)
        const ids = new Set(visible.map((n: any) => n.id))
        setNodes(visible)
        setEdges(g.edges.filter((edge: any) => ids.has(edge.source) && ids.has(edge.target)))
        setProgress(shown >= count ? null : { shown, total: count })
        refit()
        if (shown >= count) cancelStagger()
      }
      step() // show the first node immediately rather than after one interval
      if (count > 1) staggerRef.current = setInterval(step, staggerMs)
    }
    const onUpdateNode = (e: any) => {
      const { id, data } = e.detail
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data } : n)))
    }

    window.addEventListener('flow:add-node', onAdd)
    window.addEventListener('flow:export', onExport)
    window.addEventListener('flow:import', onImport as EventListener)
    window.addEventListener('flow:update-node', onUpdateNode as EventListener)

    return () => {
      window.removeEventListener('flow:add-node', onAdd)
      window.removeEventListener('flow:export', onExport)
      window.removeEventListener('flow:import', onImport as EventListener)
      window.removeEventListener('flow:update-node', onUpdateNode as EventListener)
    }
  }, [nodes, edges])

  const onNodesChange = useCallback((changes: any[]) => setNodes((nds) => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes: any[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])
  const onConnect = useCallback((connection: any) => {
    // The handle you drag from is the branch, so no need to ask for the label.
    const label = String(connection.sourceHandle || 'YES').toUpperCase()
    setEdges((es) => addEdge({ ...connection, label }, es))
  }, [])

  // Execute workflow. Failures go to the logs panel - the run used to report
  // success regardless, so a 500 was only visible in the browser console.
  const execute = useCallback(async () => {
    if (nodes.length === 0) {
      onLogs?.([{ step: 'nothing to run', error: 'Add a decision node, or import a graph, before running.' }])
      return
    }

    try {
      const resp = await fetch('/api/workflow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: { nodes, edges }, input: runInput })
      })
      const data = await resp.json()

      if (!resp.ok || data.ok === false) {
        onLogs?.([{ step: `execution failed (HTTP ${resp.status})`, error: data.error || 'unknown error' }])
        return
      }

      const logs = data.logs || []
      onLogs?.(logs.length ? logs : [{ step: 'run finished', error: 'The server returned no steps.' }])
    } catch (err) {
      onLogs?.([{ step: 'request failed', error: String(err) }])
    }
  }, [nodes, edges, runInput, onLogs])

  useEffect(() => {
    const btn = document.createElement('button')
    btn.textContent = 'Run'
    btn.className = 'fixed bottom-6 left-6 bg-green-600 text-white px-4 py-2 rounded'
    btn.onclick = () => execute()
    document.body.appendChild(btn)
    return () => btn.remove()
  }, [execute])

  return (
    <div className="bg-white border rounded p-2">
      {progress && (
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          <span>Building graph… node {progress.shown} of {progress.total}</span>
          <span className="h-1 flex-1 rounded bg-slate-200">
            <span
              className="block h-1 rounded bg-purple-500 transition-all duration-300"
              style={{ width: `${(progress.shown / progress.total) * 100}%` }}
            />
          </span>
        </div>
      )}
      <div className="reactflow-wrapper">
        <ReactFlow
          onInit={(instance: any) => (flowRef.current = instance)}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  )
}

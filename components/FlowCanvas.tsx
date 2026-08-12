'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import ReactFlow, { Background, Controls, addEdge, applyNodeChanges, applyEdgeChanges } from '@xyflow/react'
import DecisionNode from './nodes/DecisionNode'

const nodeTypes = { decision: DecisionNode }

export default function FlowCanvas({ onLogs }: { onLogs?: (l: any[]) => void }) {
  const [nodes, setNodes] = useState<any[]>([])
  const [edges, setEdges] = useState<any[]>([])
  const idRef = useRef(1)

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
      if (d?.nodes) {
        setNodes(d.nodes)
        setEdges(d.edges || [])
      }
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

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])
  const onConnect = useCallback((connection) => {
    // Default label to YES if shiftKey held? For now prompt for label
    const label = prompt('Edge label (YES or NO)') || ''
    setEdges((es) => addEdge({ ...connection, label: label.toUpperCase() }, es))
  }, [])

  // Execute workflow
  const execute = useCallback(async () => {
    const resp = await fetch('/api/workflow/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: { nodes, edges }, input: { value: 42 } })
    })
    const data = await resp.json()
    if (onLogs) onLogs(data.logs || [])
    alert('Execution completed — check logs')
  }, [nodes, edges, onLogs])

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
      <div className="reactflow-wrapper">
        <ReactFlow
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

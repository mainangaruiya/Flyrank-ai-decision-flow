import React from 'react'

export default function DecisionNode({ data, id, selected, isConnectable }: any) {
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const ev = new CustomEvent('flow:update-node', { detail: { id, data: { ...data, prompt: e.target.value } } })
    window.dispatchEvent(ev)
  }

  return (
    <div className={`p-2 bg-white border rounded shadow-sm w-56 ${selected ? 'ring-2 ring-blue-500' : ''}`}>
      <div className="font-medium">Decision</div>
      <input value={data.prompt || ''} onChange={onChange} placeholder="Prompt for LLM" className="mt-2 w-full border rounded px-2 py-1 text-sm" />
      <div className="flex justify-between text-xs mt-2">
        <div className="text-slate-400">YES →</div>
        <div className="text-slate-400">NO →</div>
      </div>
    </div>
  )
}

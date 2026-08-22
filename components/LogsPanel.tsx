"use client"

export default function LogsPanel({ logs }: { logs: any[] }) {
  return (
    <div className="bg-white border rounded p-3 h-[640px] overflow-auto">
      <h3 className="font-medium mb-2">Execution Logs</h3>
      <ul className="text-sm space-y-2">
        {logs.length === 0 && <li className="text-muted">No logs yet</li>}
        {logs.map((l, i) => (
          <li key={i} className="break-words">
            <div className={`text-xs ${l.error ? 'text-red-600' : 'text-slate-500'}`}>
              {l.step}
              {l.provider && <span className="ml-1 text-slate-400">· {l.provider}</span>}
            </div>
            {l.error
              ? <div className="text-red-600">{l.error}</div>
              : <div className={l.result === 'YES' ? 'text-green-600' : 'text-slate-900'}>{l.result}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}

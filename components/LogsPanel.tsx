"use client"

export default function LogsPanel({ logs }: { logs: any[] }) {
  return (
    <div className="bg-white border rounded p-3 h-[640px] overflow-auto">
      <h3 className="font-medium mb-2">Execution Logs</h3>
      <ul className="text-sm space-y-2">
        {logs.length === 0 && <li className="text-muted">No logs yet</li>}
        {logs.map((l, i) => (
          <li key={i} className="break-words">
            <div className="text-xs text-slate-500">{l.step}</div>
            <div>{l.result}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

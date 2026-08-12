import { NextResponse } from 'next/server'
import { executeWorkflow } from '../../../../inngest/workflow'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const graph = body.graph
    const input = body.input || {}
    const logs: any[] = []
    const res = await executeWorkflow(graph, input, (entry: any) => logs.push(entry))
    return NextResponse.json({ ok: true, logs: res.logs || logs })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

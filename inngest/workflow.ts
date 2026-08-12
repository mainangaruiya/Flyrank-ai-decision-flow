import client from './client'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type Node = { id: string; data?: any }
type Edge = { source: string; target: string; label?: string }

export async function executeWorkflow(graph: { nodes: Node[]; edges: Edge[] }, input: any, stepLogger: (entry: any) => void) {
  const nodesById = Object.fromEntries(graph.nodes.map((n) => [n.id, n]))
  const incoming = new Map<string, Edge[]>()
  for (const e of graph.edges || []) {
    const arr = incoming.get(e.target) || []
    arr.push(e)
    incoming.set(e.target, arr)
  }

  // find start: node with no incoming
  const start = graph.nodes.find((n) => !(graph.edges || []).some((e) => e.target === n.id)) || graph.nodes[0]
  const logs: any[] = []

  async function evaluateNode(nodeId: string, ctxData: any) {
    const node = nodesById[nodeId]
    if (!node) return null
    const stepName = `node:${nodeId}`
    // Wrap with inngest.step.run-like semantics for visibility/retries
    try {
      // call LLM
      const prompt = `${node.data?.prompt || 'Decide YES or NO'}\nInput: ${JSON.stringify(ctxData)}\nRespond with only YES or NO.`
      stepLogger({ step: stepName, action: 'calling_llm', prompt })
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 6,
        temperature: 0,
      })
      const raw = resp.choices?.[0]?.message?.content || ''
      const result = (raw || '').trim().toUpperCase().includes('YES') ? 'YES' : 'NO'
      logs.push({ step: stepName, result: result, raw })
      stepLogger({ step: stepName, result, raw })

      // find outgoing edge with label
      const nextEdge = (graph.edges || []).find((e) => e.source === nodeId && (e.label || '').toUpperCase() === result)
      if (nextEdge) {
        return evaluateNode(nextEdge.target, ctxData)
      }
      return result
    } catch (err: any) {
      stepLogger({ step: stepName, error: String(err) })
      throw err
    }
  }

  await evaluateNode(start.id, input)
  return { logs }
}

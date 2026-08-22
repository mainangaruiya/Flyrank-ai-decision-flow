import client from './client'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

type Node = { id: string; data?: any }
type Edge = { source: string; target: string; label?: string }

// Two providers, either one sufficient on its own. Anthropic is primary by
// default; if it errors OpenAI answers, so one provider being down is not an
// outage. Set LLM_PROVIDER=openai to flip the order.
//
//   primary   anthropic  claude-opus-5   (ANTHROPIC_MODEL)
//   fallback  openai     gpt-4o-mini     (OPENAI_MODEL)
//
// Clients are built lazily - each SDK throws on construction when its key is
// missing, which would break the provider that IS configured.
// *_BASE_URL exists so tests can point a provider at a local stub.
type Provider = { name: string; configured: boolean; ask: (prompt: string) => Promise<string> }

let openaiClient: OpenAI | null = null
let anthropicClient: Anthropic | null = null

const openaiProvider: Provider = {
  name: 'openai',
  get configured() {
    return !!process.env.OPENAI_API_KEY
  },
  async ask(prompt: string) {
    openaiClient ||= new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    })
    const resp = await openaiClient.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 6,
      temperature: 0,
    })
    return resp.choices?.[0]?.message?.content || ''
  },
}

const anthropicProvider: Provider = {
  name: 'anthropic',
  get configured() {
    return !!process.env.ANTHROPIC_API_KEY
  },
  async ask(prompt: string) {
    anthropicClient ||= new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    })
    const resp = await anthropicClient.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
      max_tokens: 1024,
      // Thinking is on by default on Opus 5. Low effort keeps a YES/NO call cheap
      // and quick without the pitfalls of disabling thinking outright.
      output_config: { effort: 'low' },
      system: 'You answer classification questions with a single word: YES or NO.',
      messages: [{ role: 'user', content: prompt }],
    })
    return resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
  },
}

export const DEFAULT_PRIMARY = 'anthropic'

function providerChain(): Provider[] {
  const primary = (process.env.LLM_PROVIDER || DEFAULT_PRIMARY).toLowerCase()
  const ordered = primary === 'openai'
    ? [openaiProvider, anthropicProvider]
    : [anthropicProvider, openaiProvider]
  return ordered.filter((p) => p.configured)
}

function describe(err: any) {
  // Both SDKs already prefix the status onto .message, so only add it when missing.
  const message = err?.message || String(err)
  const status = err?.status
  return status && !message.startsWith(String(status)) ? `${status} ${message}` : message
}

async function askWithFallback(prompt: string, stepName: string, stepLogger: (e: any) => void) {
  const chain = providerChain()
  if (chain.length === 0) {
    throw new Error('No LLM provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.')
  }

  const failures: string[] = []
  for (const provider of chain) {
    stepLogger({ step: stepName, action: 'calling_llm', provider: provider.name, prompt })
    try {
      const raw = await provider.ask(prompt)
      return { raw, provider: provider.name }
    } catch (err: any) {
      const reason = describe(err)
      failures.push(`${provider.name}: ${reason}`)
      stepLogger({ step: stepName, action: 'provider_failed', provider: provider.name, error: reason })
    }
  }

  throw new Error(`All providers failed - ${failures.join(' | ')}`)
}

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
      const prompt = `${node.data?.prompt || 'Decide YES or NO'}\nInput: ${JSON.stringify(ctxData)}\nRespond with only YES or NO.`
      const { raw, provider } = await askWithFallback(prompt, stepName, stepLogger)
      const result = (raw || '').trim().toUpperCase().includes('YES') ? 'YES' : 'NO'
      logs.push({ step: stepName, result, raw, provider })
      stepLogger({ step: stepName, result, raw, provider })

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

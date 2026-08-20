#!/usr/bin/env node
/**
 * Deterministic stand-in for the OpenAI chat/completions endpoint.
 *
 * Point the app at it with OPENAI_BASE_URL=http://127.0.0.1:<port>/v1 and the
 * workflow runs end to end with no network and no cost. It answers YES/NO by
 * actually parsing the prompt the workflow builds, so graph routing and the
 * YES/NO parse are exercised for real - only the model is faked.
 *
 *   node scripts/mock-llm.mjs --port 4010
 *
 * Handles the prompt shape from inngest/workflow.ts:
 *   <node prompt>\nInput: {"value":42}\nRespond with only YES or NO.
 *
 * Supported node prompts:
 *   "Is the value greater than N?"  -> value > N
 *   "Is the value negative?"        -> value < 0
 *   "Always answer YES"             -> YES
 * Anything else answers NO and is reported on stderr so an unmatched prompt
 * shows up as a test failure rather than silently passing.
 */

import { createServer } from 'node:http'

const argv = process.argv.slice(2)
const PORT = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 4010)

function decide(prompt) {
  const input = (() => {
    const m = prompt.match(/Input:\s*(\{.*?\})\s*$/m)
    if (!m) return {}
    try { return JSON.parse(m[1]) } catch { return {} }
  })()
  const question = prompt.split('\n')[0].trim()
  const value = input.value

  let gt
  if ((gt = question.match(/greater than\s+(-?\d+(?:\.\d+)?)/i))) {
    return { answer: Number(value) > Number(gt[1]) ? 'YES' : 'NO', matched: true }
  }
  if (/negative/i.test(question)) {
    return { answer: Number(value) < 0 ? 'YES' : 'NO', matched: true }
  }
  if (/always answer yes/i.test(question)) {
    return { answer: 'YES', matched: true }
  }
  return { answer: 'NO', matched: false, question }
}

const server = createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (!req.url.endsWith('/chat/completions') || req.method !== 'POST') {
    return send(404, { error: { message: `mock-llm: unhandled ${req.method} ${req.url}` } })
  }

  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    let prompt = ''
    try {
      prompt = JSON.parse(raw).messages?.map((m) => m.content).join('\n') ?? ''
    } catch {
      return send(400, { error: { message: 'mock-llm: body was not JSON' } })
    }

    const { answer, matched, question } = decide(prompt)
    if (!matched) console.error(`mock-llm: no rule for "${question}" - answering NO`)

    send(200, {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      model: 'mock-decider',
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 1, total_tokens: 1 },
    })
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.error(`mock-llm listening on http://127.0.0.1:${PORT}/v1`)
  if (process.send) process.send('ready')
})

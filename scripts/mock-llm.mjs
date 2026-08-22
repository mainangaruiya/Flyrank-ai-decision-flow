#!/usr/bin/env node
/**
 * Deterministic stand-in for both providers, so the workflow runs end to end with
 * no network and no cost.
 *
 *   OPENAI_BASE_URL=http://127.0.0.1:4010/v1     -> POST /v1/chat/completions
 *   ANTHROPIC_BASE_URL=http://127.0.0.1:4010     -> POST /v1/messages
 *
 *   node scripts/mock-llm.mjs --port 4010
 *
 * It answers YES/NO by parsing the prompt the workflow builds, so graph routing and
 * the YES/NO parse are exercised for real - only the model is faked.
 *
 * Failover testing: POST /__control {"failOpenAI":true} makes that provider return
 * 503 so the fallback path can be driven deterministically. GET /__control reports
 * the current flags and a per-provider call count.
 *
 * Supported node prompts, where <field> is any key of the run input ("the value"
 * is accepted for the field literally named "value"):
 *   "Is <field> greater than N?"    -> field > N
 *   "Is <field> less than N?"       -> field < N
 *   "Is <field> negative?"          -> field < 0
 *   "Is <field> true?" / "false?"   -> boolean check
 *   "Is <field> equal to X?"        -> case-insensitive string compare
 *   "Always answer YES"             -> YES
 * Anything else answers NO and is reported on stderr, so an unmatched prompt shows
 * up as a test failure rather than silently passing.
 */

import { createServer } from 'node:http'

const argv = process.argv.slice(2)
const PORT = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 4010)

const state = { failOpenAI: false, failAnthropic: false, calls: { openai: 0, anthropic: 0 } }

// "Is the amount greater than 1000?" -> field "amount". "the value" -> "value".
const FIELD = String.raw`(?:the\s+)?([A-Za-z_][A-Za-z0-9_]*)`
const yesNo = (b) => ({ answer: b ? 'YES' : 'NO', matched: true })

function decide(prompt) {
  const input = (() => {
    // The input JSON can contain nested braces, so match to the end of the line.
    const m = prompt.match(/Input:\s*(\{.*\})\s*$/m)
    if (!m) return {}
    try { return JSON.parse(m[1]) } catch { return {} }
  })()
  const question = prompt.split('\n')[0].trim()
  const get = (f) => (f in input ? input[f] : input.value)

  let m
  if ((m = question.match(new RegExp(`is\\s+${FIELD}\\s+greater than\\s+(-?\\d+(?:\\.\\d+)?)`, 'i')))) {
    return yesNo(Number(get(m[1])) > Number(m[2]))
  }
  if ((m = question.match(new RegExp(`is\\s+${FIELD}\\s+(?:less than|below|under)\\s+(-?\\d+(?:\\.\\d+)?)`, 'i')))) {
    return yesNo(Number(get(m[1])) < Number(m[2]))
  }
  if ((m = question.match(new RegExp(`is\\s+${FIELD}\\s+negative`, 'i')))) {
    return yesNo(Number(get(m[1])) < 0)
  }
  if ((m = question.match(new RegExp(`is\\s+${FIELD}\\s+(true|false)\\b`, 'i')))) {
    return yesNo(Boolean(get(m[1])) === (m[2].toLowerCase() === 'true'))
  }
  if ((m = question.match(new RegExp(`is\\s+${FIELD}\\s+(?:equal to|exactly)\\s+"?([\\w.-]+)"?`, 'i')))) {
    return yesNo(String(get(m[1])).toLowerCase() === m[2].toLowerCase())
  }
  if (/always answer yes/i.test(question)) return { answer: 'YES', matched: true }
  return { answer: 'NO', matched: false, question }
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => resolve(raw))
  })

const server = createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const url = req.url.split('?')[0]

  if (url === '/__control') {
    if (req.method === 'GET') return send(200, state)
    if (req.method === 'POST') {
      const body = await readBody(req)
      try {
        const patch = JSON.parse(body || '{}')
        if ('failOpenAI' in patch) state.failOpenAI = !!patch.failOpenAI
        if ('failAnthropic' in patch) state.failAnthropic = !!patch.failAnthropic
        if (patch.resetCalls) state.calls = { openai: 0, anthropic: 0 }
        return send(200, state)
      } catch {
        return send(400, { error: { message: 'mock-llm: control body was not JSON' } })
      }
    }
    return send(405, { error: { message: 'mock-llm: GET or POST only' } })
  }

  if (req.method !== 'POST') return send(404, { error: { message: `mock-llm: unhandled ${req.method} ${url}` } })

  const isOpenAI = url.endsWith('/chat/completions')
  const isAnthropic = url.endsWith('/v1/messages') || url.endsWith('/messages')
  if (!isOpenAI && !isAnthropic) return send(404, { error: { message: `mock-llm: unhandled ${url}` } })

  const which = isOpenAI ? 'openai' : 'anthropic'
  state.calls[which]++

  if ((isOpenAI && state.failOpenAI) || (isAnthropic && state.failAnthropic)) {
    console.error(`mock-llm: simulating ${which} outage`)
    return send(503, { error: { type: 'overloaded_error', message: `mock-llm: simulated ${which} outage` } })
  }

  const raw = await readBody(req)
  let payload
  try { payload = JSON.parse(raw) } catch { return send(400, { error: { message: 'mock-llm: body was not JSON' } }) }

  // OpenAI puts everything in messages; Anthropic splits out system.
  const prompt = [payload.system, ...(payload.messages || []).map((m) =>
    typeof m.content === 'string' ? m.content : (m.content || []).map((c) => c.text).join('\n'),
  )].filter(Boolean).join('\n')

  // The workflow's node prompt is the user turn; skip the system preamble when matching.
  const nodePrompt = (payload.messages || [])
    .map((m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((c) => c.text).join('\n')))
    .join('\n') || prompt

  const { answer, matched, question } = decide(nodePrompt)
  if (!matched) console.error(`mock-llm: no rule for "${question}" - answering NO`)

  if (isOpenAI) {
    return send(200, {
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      model: payload.model || 'mock-decider',
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 1, total_tokens: 1 },
    })
  }

  return send(200, {
    id: 'msg_mock',
    type: 'message',
    role: 'assistant',
    model: payload.model || 'mock-decider',
    content: [{ type: 'text', text: answer }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 1 },
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.error(`mock-llm listening on http://127.0.0.1:${PORT} (openai: /v1/chat/completions, anthropic: /v1/messages)`)
})

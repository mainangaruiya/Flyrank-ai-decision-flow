#!/usr/bin/env node
/**
 * Initialize the AI Decision Flow dev environment and exercise it with sample values.
 *
 *   node scripts/init-and-test.mjs            # full init + test run
 *   node scripts/init-and-test.mjs --mock     # force the local stub LLM
 *   node scripts/init-and-test.mjs --real     # never fall back to the stub
 *   node scripts/init-and-test.mjs --no-llm   # skip cases that need an LLM entirely
 *   node scripts/init-and-test.mjs --keep-up  # leave the dev server running when done
 *   node scripts/init-and-test.mjs --port 3005
 *
 * If the real OpenAI key is unusable, the run falls back to scripts/mock-llm.mjs
 * (deterministic, offline) so graph routing and the YES/NO parse still get
 * exercised. Pass --real to keep those cases BLOCKED instead.
 *
 * Sample graphs and their expected outcomes live in samples/cases.json.
 * No test dependencies - plain node 18+ (built-in fetch).
 */

import { spawn, execSync } from 'node:child_process'
import { existsSync, readFileSync, copyFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)

const SKIP_LLM = flag('--no-llm')
const FORCE_MOCK = flag('--mock')
const NO_MOCK = flag('--real')
const KEEP_UP = flag('--keep-up')
const WANT_PORT = Number(opt('--port', 3000))
const REQ_TIMEOUT = 90_000 // first request to a route pays dev-mode compilation

const C = process.stdout.isTTY
  ? { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', cyn: '\x1b[36m' }
  : { r: '', b: '', dim: '', red: '', grn: '', yel: '', cyn: '' }

const results = []
const record = (status, name, detail = '') => {
  results.push({ status, name, detail })
  const tag = { PASS: `${C.grn}PASS${C.r}`, FAIL: `${C.red}FAIL${C.r}`, BLOCKED: `${C.yel}BLOCKED${C.r}`, SKIP: `${C.dim}SKIP${C.r}` }[status]
  console.log(`  ${tag}  ${name}${detail ? `\n        ${C.dim}${detail}${C.r}` : ''}`)
}
const section = (t) => console.log(`\n${C.b}${C.cyn}${t}${C.r}`)
const note = (t) => console.log(`  ${C.dim}${t}${C.r}`)

// ---------------------------------------------------------------- 1. env setup

function parseEnvFile(p) {
  const out = {}
  if (!existsSync(p)) return out
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

function initEnv() {
  section('1. Environment')

  const major = Number(process.versions.node.split('.')[0])
  if (major < 18) {
    record('FAIL', `node ${process.versions.node} - need 18+ for built-in fetch`)
    process.exit(1)
  }
  note(`node ${process.versions.node}`)

  if (!existsSync(join(ROOT, 'node_modules'))) {
    note('node_modules missing - running npm install (this takes a minute)')
    execSync('npm install', { cwd: ROOT, stdio: 'inherit' })
  }
  note('dependencies present')

  // Next loads .env and .env.local automatically; create one if neither exists.
  const envPath = join(ROOT, '.env')
  const localPath = join(ROOT, '.env.local')
  if (!existsSync(envPath) && !existsSync(localPath)) {
    copyFileSync(join(ROOT, '.env.local.template'), localPath)
    note('created .env.local from template - the keys are EMPTY, fill them in')
  }

  const env = { ...parseEnvFile(envPath), ...parseEnvFile(localPath) }
  const loaded = [envPath, localPath].filter(existsSync).map((p) => p.replace(`${ROOT}/`, ''))
  note(`env files: ${loaded.join(', ') || 'none'}`)

  for (const k of ['OPENAI_API_KEY', 'INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY']) {
    const v = env[k]
    note(`${k.padEnd(20)} ${v ? `set (${v.length} chars)` : `${C.yel}EMPTY${C.r}`}`)
  }
  note('GROQ_API_KEY is in the template but unused by this codebase')
  note('INNGEST_* keys are unused too - /api/inngest is a log-only stub')

  return env
}

// ------------------------------------------------- 2. preflight the OpenAI key

async function preflightLLM(key) {
  section('2. LLM provider')
  if (SKIP_LLM) {
    note('--no-llm passed, not checking the key')
    return { ok: false, reason: '--no-llm' }
  }
  if (FORCE_MOCK) {
    note('--mock passed, skipping the real key check')
    return { ok: false, reason: 'forced mock' }
  }
  if (!key) {
    note('OPENAI_API_KEY is empty - every workflow run will fail')
    return { ok: false, reason: 'OPENAI_API_KEY is empty' }
  }
  // Must hit chat/completions, not /v1/models: listing models succeeds on accounts
  // with no billing, so it reports a live key that then 429s on the first real call.
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Reply with only: YES' }],
        max_tokens: 1,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (r.ok) {
      note(`${C.grn}key is live and billable${C.r} - LLM cases will run for real`)
      return { ok: true }
    }
    const body = await r.text()
    const msg = (() => {
      try { return JSON.parse(body).error?.message || body } catch { return body }
    })()
    note(`${C.yel}key rejected: HTTP ${r.status} - ${msg.slice(0, 140)}${C.r}`)
    note('LLM-dependent cases will report BLOCKED, not FAIL')
    return { ok: false, reason: `HTTP ${r.status}: ${msg.slice(0, 140)}` }
  } catch (e) {
    note(`${C.yel}could not reach the OpenAI API: ${e.message}${C.r}`)
    return { ok: false, reason: e.message }
  }
}

// ------------------------------------------------------- 3. boot the dev server

const portFree = (p) =>
  new Promise((res) => {
    const s = createServer()
    s.once('error', () => res(false))
    s.once('listening', () => s.close(() => res(true)))
    s.listen(p, '127.0.0.1')
  })

async function pickPort(start) {
  for (let p = start; p < start + 40; p++) if (await portFree(p)) return p
  throw new Error(`no free port in ${start}-${start + 40}`)
}

async function startMock(port) {
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'mock-llm.mjs'), '--port', String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (b) => {
    const s = b.toString().trim()
    // Surface unmatched prompts - they mean the stub, not the app, is wrong.
    if (s.includes('no rule for')) console.log(`  ${C.yel}${s}${C.r}`)
  })

  const base = `http://127.0.0.1:${port}/v1`
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Always answer YES\nInput: {}' }] }),
        signal: AbortSignal.timeout(2_000),
      })
      if (r.ok) {
        const j = await r.json()
        note(`stub LLM up on ${base} (self-check answered ${j.choices[0].message.content})`)
        return { child, base }
      }
    } catch {
      /* not listening yet */
    }
  }
  stopServer(child)
  throw new Error('mock LLM did not start within 15s')
}

async function startServer(port, extraEnv = {}) {
  section('3. Dev server')
  const bin = join(ROOT, 'node_modules', '.bin', 'next')
  if (!existsSync(bin)) throw new Error('next binary not found - run npm install')

  // Vars already in the environment win over .env, so this overrides the file.
  const child = spawn(bin, ['dev', '-p', String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  })
  const log = []
  const cap = (b) => log.push(b.toString())
  child.stdout.on('data', cap)
  child.stderr.on('data', cap)

  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base, { signal: AbortSignal.timeout(5_000) })
      if (r.status < 500) {
        note(`up on ${base} (pid ${child.pid})`)
        return { child, base, log }
      }
    } catch {
      /* not listening yet */
    }
  }
  console.log(log.join(''))
  throw new Error('dev server did not become ready within 120s')
}

function stopServer(child) {
  try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
}

// ------------------------------------------------------------- 4. smoke checks

async function smoke(base) {
  section('4. Smoke checks')

  try {
    const r = await fetch(base, { signal: AbortSignal.timeout(REQ_TIMEOUT) })
    const html = await r.text()
    const hasHeading = html.includes('AI Decision Flow')
    const hasToolbar = html.includes('Add Decision Node')
    if (r.status === 200 && hasHeading && hasToolbar) record('PASS', 'GET / renders the page shell')
    else record('FAIL', 'GET / renders the page shell', `status=${r.status} heading=${hasHeading} toolbar=${hasToolbar}`)
  } catch (e) {
    record('FAIL', 'GET / renders the page shell', e.message)
  }

  try {
    const r = await fetch(`${base}/api/inngest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test/event', data: { a: 1 } }),
      signal: AbortSignal.timeout(REQ_TIMEOUT),
    })
    const j = await r.json()
    if (r.status === 200 && j.ok === true) record('PASS', 'POST /api/inngest accepts an event')
    else record('FAIL', 'POST /api/inngest accepts an event', `status=${r.status} body=${JSON.stringify(j)}`)
  } catch (e) {
    record('FAIL', 'POST /api/inngest accepts an event', e.message)
  }

  try {
    const r = await fetch(`${base}/api/inngest`, { signal: AbortSignal.timeout(REQ_TIMEOUT) })
    if (r.status === 405) record('PASS', 'GET /api/inngest is 405 (POST only)')
    else record('FAIL', 'GET /api/inngest is 405 (POST only)', `got ${r.status}`)
  } catch (e) {
    record('FAIL', 'GET /api/inngest is 405 (POST only)', e.message)
  }
}

// -------------------------------------------------------- 5. sample-value cases

const isBillingError = (s = '') => /429|not active|billing|quota|insufficient/i.test(s)

async function runCases(base, llm, mocked) {
  section('5. Workflow execution with sample values')
  if (mocked) note('LLM cases are running against the local stub, not a real model')
  const cases = JSON.parse(readFileSync(join(ROOT, 'samples', 'cases.json'), 'utf8'))

  for (const c of cases) {
    if (c.requiresLLM && !llm.ok && !mocked) {
      record('BLOCKED', c.name, `needs a working OpenAI key - ${llm.reason}`)
      continue
    }

    const body = c.rawBody !== undefined ? c.rawBody : JSON.stringify({ graph: c.graph, input: c.input })
    let r, text
    try {
      r = await fetch(`${base}/api/workflow/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(REQ_TIMEOUT),
      })
      text = await r.text()
    } catch (e) {
      record('FAIL', c.name, `request failed: ${e.message}`)
      continue
    }

    let json
    try { json = JSON.parse(text) } catch {
      record('FAIL', c.name, `non-JSON response: ${text.slice(0, 200)}`)
      continue
    }

    // A live-looking key that still gets refused mid-run is a block, not a failure.
    if (json.ok === false && c.requiresLLM && isBillingError(json.error)) {
      record('BLOCKED', c.name, `OpenAI refused the call: ${String(json.error).slice(0, 140)}`)
      continue
    }

    const problems = []
    const exp = c.expect

    if (exp.status !== undefined && r.status !== exp.status) problems.push(`status ${r.status}, expected ${exp.status}`)
    if (exp.ok !== undefined && json.ok !== exp.ok) problems.push(`ok=${json.ok}, expected ${exp.ok}`)
    if (exp.errorIncludes && !String(json.error || '').includes(exp.errorIncludes)) {
      problems.push(`error missing "${exp.errorIncludes}": ${String(json.error).slice(0, 140)}`)
    }
    if (exp.steps) {
      const got = (json.logs || []).map((l) => [l.step, l.result])
      const a = JSON.stringify(got)
      const b = JSON.stringify(exp.steps)
      if (a !== b) {
        const raw = (json.logs || []).map((l) => l.raw).filter(Boolean).join(' | ')
        problems.push(`path ${a} != expected ${b}${raw ? ` (model said: ${raw})` : ''}`)
      }
    }

    if (problems.length) record('FAIL', c.name, problems.join('; '))
    else record('PASS', c.name, c.knownIssue ? `matches known issue: ${c.knownIssue}` : '')
  }
}

// ------------------------------------------------------------------- 6. summary

function summary(port, mocked) {
  const n = (s) => results.filter((r) => r.status === s).length
  const pass = n('PASS'), fail = n('FAIL'), blocked = n('BLOCKED')

  section('6. Summary')
  console.log(`  ${C.grn}${pass} passed${C.r}   ${fail ? C.red : C.dim}${fail} failed${C.r}   ${blocked ? C.yel : C.dim}${blocked} blocked${C.r}`)
  if (mocked) {
    console.log(`  ${C.yel}LLM answers came from scripts/mock-llm.mjs.${C.r} Routing, edge-label matching and`)
    console.log(`  the YES/NO parse were exercised for real; model quality was not. Re-run with a`)
    console.log(`  billable OPENAI_API_KEY (or --real) to test against the actual model.`)
  }

  if (fail) {
    console.log(`\n  ${C.red}${C.b}Failures${C.r}`)
    for (const r of results.filter((x) => x.status === 'FAIL')) console.log(`    - ${r.name}: ${r.detail}`)
  }
  if (blocked) {
    console.log(`\n  ${C.yel}${C.b}Blocked${C.r} - not code failures, an unusable OpenAI key`)
    console.log(`    Put a billable key in OPENAI_API_KEY and re-run to exercise these.`)
  }

  console.log(`\n  ${C.b}Known issues this script does not test${C.r}`)
  console.log(`    - components/nodes/DecisionNode.tsx renders no <Handle>, so nodes cannot be`)
  console.log(`      connected by dragging in the UI. Build graphs via the Import button instead.`)
  console.log(`    - npm run build fails: inngest/client.ts:3 passes 'name' to the Inngest`)
  console.log(`      constructor, which is not in ClientOptions. Dev is unaffected.`)
  console.log(`    - The UI alerts "Execution completed" even when the API returns ok:false.`)
  console.log(`    - evaluateNode has no visited-set or depth cap, so a cyclic graph recurses`)
  console.log(`      forever, one OpenAI call per hop.`)
  console.log(`    - Run input is hardcoded to {"value":42} in the UI; use this script or curl`)
  console.log(`      to drive other inputs.`)

  console.log(`\n  ${C.b}Manual UI checks worth doing by hand${C.r}`)
  console.log(`    1. Add Decision Node x4 - each offsets 20px, ids n_1..n_4`)
  console.log(`    2. Type in a node prompt - watch for dropped chars or cursor jumps`)
  console.log(`       (every keystroke round-trips a window event and rebuilds the node array)`)
  console.log(`    3. Drag / select / Delete a node`)
  console.log(`    4. Export - alert fires, clipboard holds the graph JSON`)
  console.log(`    5. Import a graph from samples/cases.json, then click the green Run button`)
  console.log(`    6. Import "not json" - expect an "Invalid JSON" alert, canvas unchanged`)
  console.log(`    7. Run twice - logs accumulate with no separator until you reload`)

  if (KEEP_UP) console.log(`\n  Dev server left running on http://localhost:${port} (--keep-up). Ctrl-C to stop.`)
  return fail ? 1 : 0
}

// ------------------------------------------------------------------------ main

let server
let mock
try {
  const env = initEnv()
  const llm = await preflightLLM(env.OPENAI_API_KEY)

  const useMock = !SKIP_LLM && !NO_MOCK && (FORCE_MOCK || !llm.ok)
  if (!llm.ok && !useMock && !SKIP_LLM) note('not falling back to the stub (--real), LLM cases will be BLOCKED')

  const port = await pickPort(WANT_PORT)
  if (port !== WANT_PORT) note(`port ${WANT_PORT} busy, using ${port}`)

  const serverEnv = {}
  if (useMock) {
    mock = await startMock(await pickPort(port + 1000))
    serverEnv.OPENAI_BASE_URL = mock.base
    // The SDK rejects an empty key even when baseURL points elsewhere.
    if (!env.OPENAI_API_KEY) serverEnv.OPENAI_API_KEY = 'mock-key'
  }

  server = await startServer(port, serverEnv)
  await smoke(server.base)
  await runCases(server.base, llm, useMock)

  const code = summary(port, useMock)
  if (KEEP_UP) {
    server.child.unref()
    mock?.child.unref()
    process.on('SIGINT', () => { stopServer(server.child); if (mock) stopServer(mock.child); process.exit(code) })
    await new Promise(() => {})
  }
  stopServer(server.child)
  if (mock) stopServer(mock.child)
  process.exit(code)
} catch (e) {
  console.error(`\n${C.red}init failed: ${e.message}${C.r}`)
  if (server) stopServer(server.child)
  if (mock) stopServer(mock.child)
  process.exit(1)
}

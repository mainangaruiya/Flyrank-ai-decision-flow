#!/usr/bin/env node
/**
 * Run the app against the local stub LLM so the Run button works without a
 * billable OpenAI key.
 *
 *   npm run dev:mock            # app on 3000, stub on 4010
 *   npm run dev:mock -- --port 3005
 *
 * Identical to `npm run dev` except OPENAI_BASE_URL points at scripts/mock-llm.mjs.
 * Answers are deterministic and come from the stub, not a real model.
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const PORT = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : '3000'
const MOCK_PORT = argv.includes('--mock-port') ? argv[argv.indexOf('--mock-port') + 1] : '4010'

const mock = spawn(process.execPath, [join(ROOT, 'scripts', 'mock-llm.mjs'), '--port', MOCK_PORT], {
  cwd: ROOT,
  stdio: ['ignore', 'inherit', 'inherit'],
})

const next = spawn(join(ROOT, 'node_modules', '.bin', 'next'), ['dev', '-p', PORT], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    // The OpenAI SDK rejects an empty key even when baseURL points elsewhere.
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'mock-key',
  },
})

console.log(`\n  LLM calls are going to the local stub on port ${MOCK_PORT}, not OpenAI.\n`)

const shutdown = () => {
  mock.kill('SIGTERM')
  next.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
next.on('exit', (code) => { mock.kill('SIGTERM'); process.exit(code ?? 0) })

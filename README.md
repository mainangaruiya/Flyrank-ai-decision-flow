# AI Decision Flow

Build a visual AI decision tree on a canvas, then run it. Each node asks an LLM a
YES/NO question about the run input, and the answer picks which edge to follow — so
only the path the answers select actually executes.

Next.js 14 (App Router) · Tailwind · React Flow (`@xyflow/react`) · Anthropic + OpenAI

## Prerequisites

- Node.js 18+ (developed on 22)
- npm
- An API key for **Anthropic or OpenAI** — either one is enough. Or neither: see
  [Running without a key](#running-without-a-key).

## 1) Install

```bash
git clone <your-repository-url>
cd Flyrank-ai-decision-flow
npm install
```

## 2) Configure

```bash
cp .env.local.template .env.local
```

Next loads both `.env` and `.env.local` automatically. Fill in what you have:

```env
# Either provider works on its own; anthropic is tried first
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Provider order: anthropic (default) or openai
LLM_PROVIDER=anthropic

# Models used by each provider
ANTHROPIC_MODEL=claude-opus-5
OPENAI_MODEL=gpt-4o-mini
```

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | one of the two | Primary provider by default. Get one at https://console.anthropic.com/settings/keys |
| `OPENAI_API_KEY` | one of the two | Fallback by default. Get one at https://platform.openai.com/api-keys |
| `LLM_PROVIDER` | no | `anthropic` (default) or `openai` — which is tried first |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5` |
| `OPENAI_MODEL` | no | Defaults to `gpt-4o-mini` |
| `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` | no | Point a provider at a local stub; used by the test scripts |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | no | **Currently unused** — see [Inngest status](#inngest-status) |
| `GROQ_API_KEY` | no | **Unused** by this codebase |

Environment is read at boot, so restart the dev server after editing it.

## 3) Run

```bash
npm run dev          # http://localhost:3000
```

If port 3000 is taken, Next prints the port it actually used — read it off the
banner rather than assuming 3000.

## 4) Use it

- **Load Demo** — builds a 10-node expense-approval tree **one node at a time,
  evenly spread over 45 seconds** (a node every 5 s), so the tree assembles at a
  pace you can narrate. A progress line above the canvas shows `node N of 10`
  while it runs. Each edge appears with the later of its two endpoints, and the
  view refits as the graph grows. Clicking again restarts the sequence; Run works
  mid-reveal on whatever is on the canvas so far. The graph, its sample input, and
  the timing all live in [`samples/demo-graph.json`](samples/demo-graph.json) —
  `totalMs` sets the duration for the whole reveal, or drop it for an instant load.
- **Add Decision Node** — drops a node; edit its prompt inline.
- **Connect nodes** — drag from the green `YES` handle or the red `NO` handle at
  the bottom of a node. The handle you drag from becomes the edge label.
- **Export / Import** — Export copies the graph JSON to the clipboard; Import
  accepts pasted JSON (see [Graph JSON](#graph-json)).
- **Run** (green button, bottom-left) — executes the graph and streams each step
  into the logs panel, tagged with the provider that answered. Failures land in
  the panel too.

Only the nodes on the selected path run. With the demo preset, 4 of the 10 nodes
execute — the rest are never called.

## Provider failover

Both providers are wired independently, so one being down is not an outage:

```
primary   anthropic   claude-opus-5     (LLM_PROVIDER=anthropic, the default)
fallback  openai      gpt-4o-mini
```

- The primary is tried first; if the call throws, the other provider answers.
- Configure only one key and that provider handles everything — the other client
  is never constructed.
- With neither key set, a run fails with
  `No LLM provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.`
- If both fail, the error names both providers and their individual reasons.

Set `LLM_PROVIDER=openai` to flip the order. Each log entry records which provider
served it, so failover is visible in the UI.

## Running without a key

`scripts/mock-llm.mjs` is a deterministic stand-in for both providers. It answers
by parsing the prompt, so graph routing and the YES/NO parse are exercised for
real — only the model is faked.

```bash
npm run dev:mock     # app + stub, no API key needed
```

Trigger an outage to watch failover live:

```bash
curl -X POST http://127.0.0.1:4010/__control -d '{"failAnthropic":true}'
curl -X POST http://127.0.0.1:4010/__control -d '{"failAnthropic":false,"failOpenAI":false}'   # reset
curl http://127.0.0.1:4010/__control                                                          # flags + call counts
```

The stub understands `Is <field> greater than N?`, `less than N`, `negative`,
`true` / `false`, and `equal to X`, where `<field>` is any key of the run input.
An unrecognized prompt answers NO and logs a warning, so it surfaces as a test
failure rather than passing silently.

## Testing

```bash
npm run init                      # set up, boot, and exercise everything
npm run init -- --mock            # force the stub instead of real providers
npm run init -- --real            # never fall back to the stub; report BLOCKED
npm run init -- --no-llm          # skip provider-dependent cases entirely
npm run init -- --primary openai  # override the provider order for this run
npm run init -- --keep-up         # leave the server running when done
npm run init -- --port 3005
```

`npm run init` checks the Node version, installs dependencies if missing, creates
`.env.local` when no env file exists, preflights each provider against the
endpoint it actually uses, picks a free port, boots the dev server, then runs:

1. **Smoke** — page shell renders, `/api/inngest` accepts a POST and 405s a GET.
2. **Sample values** — the graphs in [`samples/cases.json`](samples/cases.json),
   plus the demo preset, each asserting the exact path taken. Covers routing,
   case-insensitive edge labels, non-exact labels not routing, root selection by
   incoming-edge count, and malformed-input handling.
3. **Failover** — with the stub, every outage combination against the configured
   provider order.

If no provider key is usable it falls back to the stub automatically and says so;
provider-dependent cases report `BLOCKED` rather than `FAIL` when you pass
`--real`. Exit code is non-zero only on real failures.

Add cases by editing `samples/cases.json` — it's data, not code. The demo preset
is read straight from `samples/demo-graph.json`, so the button and its expected
path can't drift apart.

## Graph JSON

Nodes need `id` and `data.prompt`; edges need `source`, `target`, and a `YES`/`NO`
`label`. Everything else is filled in on import — `type`, `position`, edge `id`,
and the `sourceHandle` derived from the label. Optional top-level keys: `input`
becomes the run input (default `{"value": 42}`); `totalMs` reveals the nodes one
at a time, spread evenly over that many milliseconds; `staggerMs` sets the gap
between nodes directly instead (`totalMs` wins if both are present).

```json
{
  "input": { "value": 42 },
  "nodes": [
    { "id": "n_1", "data": { "prompt": "Is the value greater than 10?" } },
    { "id": "n_2", "data": { "prompt": "Is the value greater than 100?" } }
  ],
  "edges": [{ "source": "n_1", "target": "n_2", "label": "YES" }]
}
```

Import uses a browser `prompt()`, which is a single-line box — pasting
pretty-printed JSON works, but it is not a comfortable editor for large graphs.

## Project layout

```
app/
  page.tsx                        canvas + logs panel
  api/workflow/execute/route.ts   POST { graph, input } -> { ok, logs }
  api/inngest/route.ts            event receiver stub
components/
  FlowCanvas.tsx                  React Flow wiring, import normalization, Run
  Toolbar.tsx                     Load Demo / Add Node / Export / Import
  LogsPanel.tsx                   per-step results, provider tag, errors
  nodes/DecisionNode.tsx          node with target + YES/NO source handles
inngest/
  workflow.ts                     provider chain, failover, graph traversal
  client.ts                       Inngest client
samples/
  demo-graph.json                 the Load Demo preset (also a test case)
  cases.json                      test graphs and expected paths
scripts/
  init-and-test.mjs               setup + test runner
  mock-llm.mjs                    deterministic stub for both providers
  dev-with-mock.mjs               npm run dev:mock
```

## Inngest status

`/api/inngest` currently only logs the request body and returns `{ ok: true }`.
It registers no Inngest function and does **not** verify the signing key, so it
will accept an unsigned request from anyone. Workflow execution runs inline in the
Next request instead, so there are no step histories or retries in the Inngest
dashboard. `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are unused until this is
wired up.

## Known issues

- **`npm run build` fails.** `inngest/client.ts:3` passes `name` to the `Inngest`
  constructor, which isn't a valid `ClientOptions` property. Compilation succeeds;
  only the type check fails. `npm run dev` is unaffected.
- **Malformed requests return 500, not 400.** An empty graph, a missing `graph`
  key, or an empty body all surface a raw `TypeError` / `SyntaxError`.
- **No cycle guard.** `evaluateNode` recurses with no visited set and no depth cap,
  so a graph with a loop spins forever, one LLM call per hop.
- **Logs accumulate across runs** with no separator until you reload the page.
- Import is a single-line `prompt()`; there's no textarea or file picker.

## Next steps

- Validate request bodies and return 400s with useful messages
- Add a visited set / depth cap to `evaluateNode`
- Register a real Inngest function and verify signatures
- Editable run input in the UI, and start/end node types
- Persistence and auth for saved graphs

# AI Decision Flow

This is a starter full-stack project implementing a visual AI Decision Flow using Next.js (App Router), Tailwind CSS, React Flow, and Inngest for workflow execution.

Quick start

1. Copy `.env.local.template` to `.env.local` and fill in `OPENAI_API_KEY` and optionally `INNGEST_*` keys.
2. Install dependencies:

```bash
npm install
```

3. Run the dev server:

```bash
npm run dev
```

Open http://localhost:3000. Use the toolbar to add decision nodes, connect them with edges labeled YES or NO, then press Run to execute the workflow. Execution logs will appear in the right panel.

Notes
- The server-side OpenAI call is implemented in `/inngest/workflow.ts` and invoked by `/app/api/workflow/execute/route.ts`.
- The Inngest API route is present at `/api/inngest` as a basic receiver.

Next steps
- Improve node editing UX and add start/end node types.
- Add authentication and persistent storage for graphs.
- Harden Inngest event verification and signatures.
# Flyrank-ai-decision-flow
# AI Decision Flow

This project is a starter full-stack app for building a visual AI decision flow using Next.js, Tailwind CSS, React Flow, and Inngest.

## Prerequisites

Before you start, make sure you have:

- Node.js 18+ installed
- npm installed
- A free OpenAI account
- An Inngest account (optional for local workflow execution, but recommended if you want to use the Inngest integration)

## 1) Clone the project

```bash
git clone <your-repository-url>
cd Flyrank-ai-decision-flow
```

## 2) Install dependencies

```bash
npm install
```

## 3) Create your environment file

Copy the template file into a local environment file:

```bash
cp .env.local.template .env.local
```

Open `.env.local` and fill in the keys.

## 4) Get the required API keys

### OpenAI API key

1. Go to https://platform.openai.com/api-keys
2. Sign in to your OpenAI account
3. Create a new API key
4. Copy the key and paste it into `.env.local`:

```env
OPENAI_API_KEY=your_openai_key_here
```

### Inngest keys

1. Go to https://app.inngest.com/
2. Sign in or create an account
3. Create or open your app
4. In the app settings, find the keys section
5. Copy the Event Key and Signing Key and add them to `.env.local`:

```env
INNGEST_EVENT_KEY=your_inngest_event_key
INNGEST_SIGNING_KEY=your_inngest_signing_key
```

> The template also includes `GROQ_API_KEY`, but this project currently uses the OpenAI key for the workflow execution path.

## 5) Start the app

Run the development server:


```bash
npm run dev
```
liabilities/assets
Then open:

```text
http://localhost:3000
```

## 6) Use the app

- Add decision nodes from the toolbar
- Connect nodes with YES/NO edges
- Click Run to execute the workflow
- Watch execution logs appear in the right-side panel

## Project notes

- The OpenAI workflow execution is implemented in `/inngest/workflow.ts`
- The execute route is handled in `/app/api/workflow/execute/route.ts`
- The Inngest receiver API is available at `/api/inngest`

## Next steps

- Improve node editing UX and add start/end node types
- Add authentication and persistent storage for graphs
- Harden Inngest event verification and signatures

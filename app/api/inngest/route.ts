import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  // Basic endpoint for incoming Inngest events; expand as needed.
  try {
    const body = await req.json()
    console.log('Inngest event received', body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 400 })
  }
}

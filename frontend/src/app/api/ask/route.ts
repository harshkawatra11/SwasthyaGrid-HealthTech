import { NextResponse } from "next/server";

export const runtime = "nodejs";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";

const FALLBACK_MESSAGE =
  "Ask SwasthyaGrid is unavailable right now: the backend at " +
  API_BASE +
  " is not reachable. The rest of the dashboard works independently of this feature.";

/**
 * Proxies to the FastAPI backend's grounded HealthAgent (/api/v1/ask) instead
 * of running a second, independent Gemini call against a static local
 * snapshot. The backend's tools read the same DistrictRepository the REST
 * API and the voice agent use, so a typed answer and a spoken answer about
 * the same facility can never disagree. See docs/01-architecture.md.
 */
export async function POST(request: Request) {
  const { message } = (await request.json()) as { message?: string };

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      const detail = errBody?.detail ?? FALLBACK_MESSAGE;
      return NextResponse.json({ error: detail }, { status: res.status });
    }

    const data = (await res.json()) as { answer: string; tool_calls?: string[]; confidence?: number | null };
    return NextResponse.json({
      answer: data.answer,
      toolCalls: data.tool_calls ?? [],
      confidence: data.confidence ?? undefined,
    });
  } catch (error) {
    console.error("Ask proxy to backend failed", error);
    return NextResponse.json({ answer: FALLBACK_MESSAGE, confidence: null });
  }
}

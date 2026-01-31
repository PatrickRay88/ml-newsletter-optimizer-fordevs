import { NextResponse } from "next/server";
import { processDueFlowRuns } from "@/lib/flows";

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return undefined;
}

export async function POST(request: Request) {
  try {
    let payload: unknown = null;

    try {
      const raw = await request.text();
      if (raw) {
        payload = JSON.parse(raw);
      }
    } catch {
      payload = null;
    }

    const limit = payload && typeof payload === "object" ? parseNumber((payload as { limit?: unknown }).limit) : undefined;
    const nowInput = payload && typeof payload === "object" ? (payload as { now?: unknown }).now : undefined;
    const now = parseDate(nowInput) ?? new Date();

    const summary = await processDueFlowRuns({ limit, now });
    const message = `Processed ${summary.evaluated} runs • completed: ${summary.completed}, rescheduled: ${summary.rescheduled}, cancelled: ${summary.cancelled}, failed: ${summary.failed}`;

    return NextResponse.json({ success: true, message, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process flows";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

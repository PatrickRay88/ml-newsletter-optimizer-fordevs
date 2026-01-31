import { NextResponse } from "next/server";
import { runHygieneSweep } from "@/lib/hygiene";

function resolveBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "on") {
      return true;
    }
    if (lower === "false" || lower === "off") {
      return false;
    }
  }
  return undefined;
}

export async function POST(request: Request) {
  try {
    let parsedBody: unknown = null;
    try {
      const raw = await request.text();
      if (raw) {
        parsedBody = JSON.parse(raw);
      }
    } catch {
      parsedBody = null;
    }

    const url = new URL(request.url);
    const suppressParam = url.searchParams.get("suppress");
    const suppressHighRisk =
      resolveBoolean(suppressParam) ?? resolveBoolean(parsedBody && typeof parsedBody === "object" ? (parsedBody as { suppressHighRisk?: unknown }).suppressHighRisk : undefined);

    const summary = await runHygieneSweep({ suppressHighRisk });

    const message = `Evaluated ${summary.evaluated} contacts | high: ${summary.highRisk}, medium: ${summary.mediumRisk}, low: ${summary.lowRisk}, suppressed: ${summary.contactsSuppressed}`;

    return NextResponse.json({
      success: true,
      message,
      summary
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run hygiene sweep";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { formatBroadcastSummary, sendBroadcastById } from "@/lib/broadcasts";
import { ResendError } from "@/lib/resend";

type RouteParams = {
  params: {
    id: string;
  };
};

function resolveUseOptimizer(request: Request, body: unknown): boolean | undefined {
  const url = new URL(request.url);
  const optimizerParam = url.searchParams.get("optimizer");
  if (optimizerParam) {
    const lowered = optimizerParam.toLowerCase();
    if (lowered === "false" || lowered === "off") {
      return false;
    }
    if (lowered === "true" || lowered === "on") {
      return true;
    }
  }

  if (body && typeof body === "object" && "useOptimizer" in body) {
    const value = (body as { useOptimizer?: unknown }).useOptimizer;
    if (typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
}

export async function POST(request: Request, { params }: RouteParams) {
  const broadcastId = params.id;

  if (!broadcastId) {
    return NextResponse.json(
      {
        success: false,
        message: "Broadcast id is required"
      },
      { status: 400 }
    );
  }

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

    const useOptimizer = resolveUseOptimizer(request, parsedBody);
    const summary = await sendBroadcastById(broadcastId, {
      useOptimizer
    });
    const message = formatBroadcastSummary(summary);
    return NextResponse.json({
      success: true,
      message,
      summary
    });
  } catch (error) {
    if (error instanceof ResendError) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
          status: error.status
        },
        { status: error.status === 0 ? 502 : Math.max(error.status, 400) }
      );
    }

    const message = error instanceof Error ? error.message : "Unable to send broadcast";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 500 }
    );
  }
}

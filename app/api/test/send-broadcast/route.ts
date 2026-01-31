import { NextResponse } from "next/server";
import { BroadcastStatus, WorkspaceMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createBroadcastDraft, formatBroadcastSummary, sendBroadcastById } from "@/lib/broadcasts";
import { ResendError } from "@/lib/resend";
import { recordTestBroadcastSent } from "@/lib/settings";

const TEST_BROADCAST_NAME = "Onboarding Test Broadcast";

async function ensureTestBroadcast(): Promise<string> {
  const existing = await prisma.broadcast.findFirst({
    where: { name: TEST_BROADCAST_NAME },
    orderBy: { createdAt: "desc" }
  });

  if (existing && existing.status !== BroadcastStatus.SENT) {
    return existing.id;
  }

  const created = await createBroadcastDraft({
    name: TEST_BROADCAST_NAME,
    sendMode: WorkspaceMode.TEST
  });

  return created.id;
}

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

export async function POST(request: Request) {
  try {
    const broadcastId = await ensureTestBroadcast();
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

    if (!summary.alreadySent) {
      await recordTestBroadcastSent(new Date());
    }

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

    const message = error instanceof Error ? error.message : "Unable to send test broadcast";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { BroadcastStatus, WorkspaceMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BroadcastSendStrategy } from "@/lib/broadcasts";
import { createBroadcastDraft, formatBroadcastSummary, sendBroadcastById } from "@/lib/broadcasts";
import { ResendError } from "@/lib/resend";
import { recordTestBroadcastSent } from "@/lib/settings";

const TEST_BROADCAST_NAME = "Onboarding Test Broadcast";

async function ensureTestBroadcast(): Promise<string> {
  const existingDraft = await prisma.broadcast.findFirst({
    where: { name: TEST_BROADCAST_NAME },
    orderBy: { createdAt: "desc" },
    include: {
      messages: {
        select: { id: true },
        take: 1
      }
    }
  });

  if (existingDraft && existingDraft.status === BroadcastStatus.DRAFT && existingDraft.messages.length === 0) {
    return existingDraft.id;
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

  // Onboarding defaults to immediate send so Sandbox outcomes are observable without waiting on schedule dispatch.
  return false;
}

function normalizeSendStrategy(value: unknown): BroadcastSendStrategy | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "bulk") {
    return "bulk";
  }
  if (normalized === "individual") {
    return "individual";
  }

  return undefined;
}

function resolveSendStrategy(request: Request, body: unknown): BroadcastSendStrategy | undefined {
  const url = new URL(request.url);
  const strategyFromQuery = normalizeSendStrategy(url.searchParams.get("strategy"));
  if (strategyFromQuery) {
    return strategyFromQuery;
  }

  if (body && typeof body === "object" && "sendStrategy" in body) {
    return normalizeSendStrategy((body as { sendStrategy?: unknown }).sendStrategy);
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
    const sendStrategy = resolveSendStrategy(request, parsedBody);
    const summary = await sendBroadcastById(broadcastId, {
      useOptimizer,
      sendStrategy
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

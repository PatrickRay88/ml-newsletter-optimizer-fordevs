import { NextResponse } from "next/server";
import { WorkspaceMode } from "@prisma/client";
import { createBroadcastDraft } from "@/lib/broadcasts";

function parseSendMode(value: unknown): WorkspaceMode {
  if (typeof value !== "string") {
    return WorkspaceMode.TEST;
  }

  return value.toUpperCase() === "PRODUCTION" ? WorkspaceMode.PRODUCTION : WorkspaceMode.TEST;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  const rawName = typeof body.name === "string" ? body.name : "Untitled Broadcast";
  const name = rawName.trim() || "Untitled Broadcast";
  const templateId = typeof body.templateId === "string" ? body.templateId : undefined;
  const segmentId = typeof body.segmentId === "string" ? body.segmentId : undefined;
  const sendMode = parseSendMode(body.sendMode);

  try {
    const broadcast = await createBroadcastDraft({
      name,
      templateId,
      segmentId,
      sendMode
    });

    return NextResponse.json({
      success: true,
      broadcast
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create broadcast";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 400 }
    );
  }
}

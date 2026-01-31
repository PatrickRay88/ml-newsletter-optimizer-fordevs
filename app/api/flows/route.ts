import { NextResponse } from "next/server";
import { FlowStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createFlowDefinition, getFlowsOverview } from "@/lib/flows";

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

export async function GET() {
  const flows = await getFlowsOverview();
  return NextResponse.json({ flows });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, message: "Request body must be an object" }, { status: 400 });
    }

    const { name, triggerEventName, templateId } = body as Record<string, unknown>;

    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ success: false, message: "Flow name is required" }, { status: 400 });
    }

    if (typeof triggerEventName !== "string" || triggerEventName.trim().length === 0) {
      return NextResponse.json({ success: false, message: "Trigger event name is required" }, { status: 400 });
    }

    if (typeof templateId !== "string" || templateId.trim().length === 0) {
      return NextResponse.json({ success: false, message: "Template id is required" }, { status: 400 });
    }

    const delayMinutes = parseNumber((body as { delayMinutes?: unknown }).delayMinutes);
    const segmentIdRaw = (body as { segmentId?: unknown }).segmentId;
    const useOptimizerRaw = (body as { useOptimizer?: unknown }).useOptimizer;
    const statusRaw = (body as { status?: unknown }).status;

    const segmentId = typeof segmentIdRaw === "string" && segmentIdRaw.length > 0 ? segmentIdRaw : undefined;
    const useOptimizer = typeof useOptimizerRaw === "boolean" ? useOptimizerRaw : undefined;

    let status: FlowStatus | undefined;
    if (typeof statusRaw === "string" && statusRaw in FlowStatus) {
      status = statusRaw as FlowStatus;
    }

    const flow = await createFlowDefinition({
      name: name.trim(),
      triggerEventName: triggerEventName.trim(),
      templateId: templateId.trim(),
      delayMinutes: delayMinutes ?? null,
      segmentId,
      useOptimizer
    });

    if (status && status !== FlowStatus.DRAFT) {
      await prisma.flow.update({ where: { id: flow.id }, data: { status } });
    }

    return NextResponse.json({ success: true, flow });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create flow";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { ContactStatus } from "@prisma/client";
import { createSegment, buildSegmentDefinition, SegmentFilterDefinition } from "@/lib/segments";

function parseFilters(input: unknown): SegmentFilterDefinition[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const filters: SegmentFilterDefinition[] = [];

  input.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const { type, value } = item as { type?: string; value?: unknown };
    if (type === "status" && typeof value === "string") {
      if (Object.values(ContactStatus).includes(value.toUpperCase() as ContactStatus)) {
        filters.push({ type: "status", value: value.toUpperCase() as ContactStatus });
      }
      return;
    }
    if (type === "tag" && typeof value === "string" && value.trim()) {
      filters.push({ type: "tag", value: value.trim() });
      return;
    }
    if (type === "timezone" && typeof value === "string" && value.trim()) {
      filters.push({ type: "timezone", value: value.trim() });
      return;
    }
    if (type === "last_event_within_days" && typeof value === "number" && Number.isFinite(value)) {
      filters.push({ type: "last_event_within_days", value: Math.max(0, Math.floor(value)) });
    }
  });

  return buildSegmentDefinition(filters).filters;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== "string") {
    return NextResponse.json(
      {
        success: false,
        message: "Segment name is required"
      },
      { status: 400 }
    );
  }

  try {
    const segment = await createSegment({
      name: body.name,
      description: typeof body.description === "string" ? body.description : null,
      filters: parseFilters(body.filters)
    });

    return NextResponse.json({
      success: true,
      segment
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create segment";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 400 }
    );
  }
}

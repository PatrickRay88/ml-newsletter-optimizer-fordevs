import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { triggerFlowsForEvent } from "@/lib/flows";

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
    const body = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, message: "Request body must be an object" }, { status: 400 });
    }

    const { contactId, contactEmail, eventName } = body as Record<string, unknown>;

    if ((typeof contactId !== "string" || contactId.trim().length === 0) && (typeof contactEmail !== "string" || contactEmail.trim().length === 0)) {
      return NextResponse.json({ success: false, message: "Provide contactId or contactEmail" }, { status: 400 });
    }

    if (typeof eventName !== "string" || eventName.trim().length === 0) {
      return NextResponse.json({ success: false, message: "eventName is required" }, { status: 400 });
    }

    let contact = null;

    if (typeof contactId === "string" && contactId.trim().length > 0) {
      contact = await prisma.contact.findUnique({ where: { id: contactId.trim() } });
    }

    if (!contact && typeof contactEmail === "string" && contactEmail.trim().length > 0) {
      contact = await prisma.contact.findUnique({ where: { email: contactEmail.trim().toLowerCase() } });
    }

    if (!contact) {
      return NextResponse.json({ success: false, message: "Contact not found" }, { status: 404 });
    }

    const occurredAt = parseDate((body as { occurredAt?: unknown }).occurredAt) ?? new Date();
    const externalUserId = typeof (body as { externalUserId?: unknown }).externalUserId === "string" ? (body as { externalUserId?: string }).externalUserId : undefined;
    const propertiesRaw = (body as { properties?: unknown }).properties;
    let properties: Prisma.InputJsonValue | Prisma.JsonNullValueInput | undefined;
    if (propertiesRaw === null) {
      properties = Prisma.JsonNull;
    } else if (propertiesRaw !== undefined) {
      properties = propertiesRaw as Prisma.InputJsonValue;
    }

    const event = await prisma.event.create({
      data: {
        contactId: contact.id,
        eventName: eventName.trim(),
        externalUserId: externalUserId ?? null,
        timestamp: occurredAt,
        properties
      }
    });

    const summary = await triggerFlowsForEvent({
      contactId: contact.id,
      eventName: event.eventName,
      eventId: event.id,
      properties: event.properties ?? undefined,
      occurredAt
    });

    return NextResponse.json({ success: true, eventId: event.id, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record event";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

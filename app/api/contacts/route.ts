import { NextResponse } from "next/server";
import { ContactStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function normalizeTags(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/[;,|]/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ success: false, message: "Request body must be JSON" }, { status: 400 });
  }

  const emailRaw = typeof (body as { email?: unknown }).email === "string" ? (body as { email?: string }).email : "";
  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ success: false, message: "Email is required" }, { status: 400 });
  }

  const timezone = typeof (body as { timezone?: unknown }).timezone === "string"
    ? (body as { timezone?: string }).timezone?.trim() || null
    : null;
  const tags = normalizeTags((body as { tags?: unknown }).tags);

  try {
    const result = await prisma.contact.upsert({
      where: { email },
      update: {
        timezone,
        tags
      },
      create: {
        email,
        timezone,
        tags,
        status: ContactStatus.ACTIVE
      }
    });

    return NextResponse.json({ success: true, contact: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create contact";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

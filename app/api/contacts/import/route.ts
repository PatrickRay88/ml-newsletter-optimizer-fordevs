import { NextResponse } from "next/server";
import { importContactsFromCsv } from "@/lib/contacts";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return NextResponse.json(
      {
        success: false,
        message: "Expected application/json payload"
      },
      { status: 415 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.csv !== "string") {
    return NextResponse.json(
      {
        success: false,
        message: "Body must include csv string"
      },
      { status: 400 }
    );
  }

  try {
    const result = await importContactsFromCsv(body.csv);
    return NextResponse.json({
      success: true,
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import contacts";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 400 }
    );
  }
}

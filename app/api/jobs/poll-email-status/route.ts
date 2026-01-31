import { NextResponse } from "next/server";
import { pollPendingMessages } from "@/lib/outcomes";

export async function POST() {
  try {
    const summary = await pollPendingMessages();
    return NextResponse.json({
      success: true,
      summary
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to poll email status";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 500 }
    );
  }
}

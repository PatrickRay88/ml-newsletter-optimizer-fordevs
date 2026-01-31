import { NextResponse } from "next/server";
import { getSettingsSummary } from "@/lib/settings";
import { testResendConnection } from "@/lib/resend";

export async function POST() {
  try {
    const result = await testResendConnection();
    const summary = await getSettingsSummary();

    const status = result.success ? 200 : result.status || 502;

    return NextResponse.json(
      {
        ...result,
        hasResendApiKey: summary.hasResendApiKey,
        resendLastValidatedAt: summary.resendLastValidatedAt?.toISOString() ?? null
      },
      { status }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while testing Resend connection";
    return NextResponse.json(
      {
        success: false,
        status: 500,
        message
      },
      { status: 500 }
    );
  }
}

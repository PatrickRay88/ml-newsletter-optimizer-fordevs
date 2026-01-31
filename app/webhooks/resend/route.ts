import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSettingsSummary, getWebhookSecret, updateWebhookReceipt } from "@/lib/settings";
import { processResendWebhook, type ResendWebhookEvent } from "@/lib/webhooks";

function validateSignature(payload: string, signature: string, secret: string): boolean {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let event: ResendWebhookEvent | null = null;

  try {
    event = JSON.parse(rawBody) as ResendWebhookEvent;
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON payload" }, { status: 400 });
  }

  const settings = await getSettingsSummary();
  const webhookSecret = await getWebhookSecret();

  if (settings.webhookEnabled && webhookSecret) {
    const signature = request.headers.get("resend-signature") ?? "";
    if (!signature || !validateSignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json({ success: false, message: "Invalid webhook signature" }, { status: 401 });
    }
  }

  const result = await processResendWebhook(event);
  await updateWebhookReceipt(new Date());

  return NextResponse.json({
    success: true,
    handled: result.handled,
    messageId: result.messageId,
    outcome: result.outcome,
    reason: result.reason ?? null
  });
}

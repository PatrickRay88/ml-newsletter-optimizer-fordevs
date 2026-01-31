import { NextResponse } from "next/server";
import { getSettingsSummary, updateSettings } from "@/lib/settings";
import { encryptionEnabled } from "@/lib/encryption";
import { isWorkspaceMode, WORKSPACE_MODES } from "@/lib/workspace";

type PutPayload = {
  mode?: string;
  resendApiKey?: string | null;
  webhookSecret?: string | null;
  webhookEnabled?: boolean;
};

const VALID_MODES = new Set(WORKSPACE_MODES);

export async function GET() {
  const summary = await getSettingsSummary();

  return NextResponse.json({
    ...summary,
    encryptionEnabled: encryptionEnabled()
  });
}

export async function PUT(request: Request) {
  let body: PutPayload;

  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.mode || !isWorkspaceMode(body.mode)) {
    return NextResponse.json(
      { message: "mode must be either TEST or PRODUCTION" },
      { status: 400 }
    );
  }

  try {
    const resendApiKey = body.resendApiKey === undefined ? undefined : body.resendApiKey;
    const webhookSecret = body.webhookSecret === undefined ? undefined : body.webhookSecret;
    const webhookEnabled = typeof body.webhookEnabled === "boolean" ? body.webhookEnabled : undefined;
    const summary = await updateSettings({
      mode: body.mode,
      resendApiKey,
      webhookSecret,
      webhookEnabled
    });

    return NextResponse.json({
      ...summary,
      encryptionEnabled: encryptionEnabled()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update settings";
    return NextResponse.json({ message }, { status: 500 });
  }
}

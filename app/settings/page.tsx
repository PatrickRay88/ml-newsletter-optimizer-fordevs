import { encryptionEnabled } from "@/lib/encryption";
import { getSettingsSummary } from "@/lib/settings";
import SettingsForm from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettingsSummary();
  const encryptionReady = encryptionEnabled();

  return (
    <main style={{ padding: "3rem", maxWidth: "48rem", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "1rem" }}>Settings</h1>
      <p style={{ marginBottom: "2rem", lineHeight: 1.5 }}>
        Manage workspace configuration for the Email Autopilot demo. Secrets are stored server-side and the
        mode defaults to Test Mode so sends remain in resend.dev inboxes.
      </p>
      <SettingsForm
        initialSettings={{
          mode: settings.mode,
          testModeEnabled: settings.testModeEnabled,
          hasResendApiKey: settings.hasResendApiKey,
          resendLastValidatedAt: settings.resendLastValidatedAt?.toISOString() ?? null,
          webhookEnabled: settings.webhookEnabled,
          webhookLastReceivedAt: settings.webhookLastReceivedAt?.toISOString() ?? null,
          encryptionEnabled: encryptionReady
        }}
      />
    </main>
  );
}

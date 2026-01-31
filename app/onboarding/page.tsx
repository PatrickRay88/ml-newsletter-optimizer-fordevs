import { getOnboardingState } from "@/lib/onboarding";
import { encryptionEnabled } from "@/lib/encryption";
import OnboardingChecklist from "./checklist";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const state = await getOnboardingState();
  const encryptionReady = encryptionEnabled();
  const baseUrl = process.env.APP_BASE_URL ?? "";

  return (
    <main style={{ padding: "3rem", maxWidth: "64rem", margin: "0 auto" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Onboarding</h1>
      <p style={{ color: "#94a3b8", marginBottom: "2rem", lineHeight: 1.5 }}>
        Complete these steps to prepare the Email Autopilot demo workspace. All data stays within Test Mode
        using deterministic synthetic contacts and resend.dev inboxes.
      </p>
      <OnboardingChecklist
        baseUrl={baseUrl}
        initialState={{
          settings: {
            ...state.settings,
            resendLastValidatedAt: state.settings.resendLastValidatedAt?.toISOString() ?? null,
            webhookLastReceivedAt: state.settings.webhookLastReceivedAt?.toISOString() ?? null,
            onboardingTestListCreatedAt:
              state.settings.onboardingTestListCreatedAt?.toISOString() ?? null,
            onboardingTestBroadcastSentAt:
              state.settings.onboardingTestBroadcastSentAt?.toISOString() ?? null,
            encryptionEnabled: encryptionReady
          }
        }}
      />
    </main>
  );
}

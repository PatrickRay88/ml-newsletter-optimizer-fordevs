import { getSettingsSummary, type SettingsSummary } from "./settings";

export type OnboardingStepKey = "connect-resend" | "choose-mode" | "webhooks" | "send-test";

export type OnboardingStep = {
  key: OnboardingStepKey;
  title: string;
  description: string;
  completed: boolean;
  optional?: boolean;
  lastCompletedAt: Date | null;
};

function mapSteps(summary: SettingsSummary): OnboardingStep[] {
  const connectComplete = summary.hasResendApiKey && Boolean(summary.resendLastValidatedAt);
  const modeComplete = summary.mode === "PRODUCTION" ? true : summary.mode === "TEST";
  const webhookComplete = summary.webhookEnabled && Boolean(summary.webhookLastReceivedAt);
  const sendTestComplete = Boolean(
    summary.onboardingTestListCreatedAt && summary.onboardingTestBroadcastSentAt
  );

  return [
    {
      key: "connect-resend",
      title: "Connect Resend",
      description: "Store the Resend API key securely and verify connectivity.",
      completed: connectComplete,
      lastCompletedAt: summary.resendLastValidatedAt ?? null
    },
    {
      key: "choose-mode",
      title: "Choose Mode",
      description: "Test Mode keeps sends in resend.dev inboxes; Production Mode requires a verified domain.",
      completed: Boolean(modeComplete),
      lastCompletedAt: null
    },
    {
      key: "webhooks",
      title: "Webhooks (Optional)",
      description: "Enable Resend webhooks for real-time outcomes or continue with polling only.",
      completed: webhookComplete,
      optional: true,
      lastCompletedAt: summary.webhookLastReceivedAt ?? null
    },
    {
      key: "send-test",
      title: "Send a Test",
      description: "Create the test list, send a broadcast, and monitor delivery outcomes.",
      completed: sendTestComplete,
      lastCompletedAt: summary.onboardingTestBroadcastSentAt ?? null
    }
  ];
}

export type OnboardingState = {
  steps: OnboardingStep[];
  settings: SettingsSummary;
};

export async function getOnboardingState(): Promise<OnboardingState> {
  const summary = await getSettingsSummary();
  return {
    settings: summary,
    steps: mapSteps(summary)
  };
}

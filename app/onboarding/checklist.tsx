"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceModeValue } from "@/lib/workspace";

export type OnboardingStepClient = {
  key: "connect-resend" | "choose-mode" | "webhooks" | "send-test";
  title: string;
  description: string;
  completed: boolean;
  optional?: boolean;
  lastCompletedAt: string | null;
};

export type OnboardingSettingsClient = {
  mode: WorkspaceModeValue;
  testModeEnabled: boolean;
  hasResendApiKey: boolean;
  resendLastValidatedAt: string | null;
  webhookEnabled: boolean;
  webhookLastReceivedAt: string | null;
  onboardingTestListCreatedAt: string | null;
  onboardingTestBroadcastSentAt: string | null;
  encryptionEnabled: boolean;
};

type Props = {
  baseUrl: string;
  initialState: {
    settings: OnboardingSettingsClient;
  };
};

type ActionStatus = {
  type: "idle" | "success" | "error";
  message?: string;
};

type ActionKey = "resend-test" | "create-test-list" | "send-test-broadcast" | "run-poller" | "update-mode";

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  return date.toLocaleString();
}

function deriveSteps(settings: OnboardingSettingsClient): OnboardingStepClient[] {
  const connectComplete = settings.hasResendApiKey && Boolean(settings.resendLastValidatedAt);
  const webhookComplete = settings.webhookEnabled && Boolean(settings.webhookLastReceivedAt);
  const sendTestComplete = Boolean(
    settings.onboardingTestListCreatedAt && settings.onboardingTestBroadcastSentAt
  );

  return [
    {
      key: "connect-resend",
      title: "Connect Resend",
      description: "Store the Resend API key securely and verify connectivity.",
      completed: connectComplete,
      optional: false,
      lastCompletedAt: settings.resendLastValidatedAt
    },
    {
      key: "choose-mode",
      title: "Choose Mode",
      description: "Test Mode keeps sends in resend.dev inboxes; Production Mode requires a verified domain.",
      completed: true,
      optional: false,
      lastCompletedAt: null
    },
    {
      key: "webhooks",
      title: "Webhooks (Optional)",
      description: "Enable webhooks for real-time outcomes. Polling remains available if disabled.",
      completed: webhookComplete,
      optional: true,
      lastCompletedAt: settings.webhookLastReceivedAt
    },
    {
      key: "send-test",
      title: "Send a Test",
      description: "Create the test list, send a broadcast, and observe delivery outcomes.",
      completed: sendTestComplete,
      optional: false,
      lastCompletedAt: settings.onboardingTestBroadcastSentAt
    }
  ];
}

const STEP_THEME: Record<OnboardingStepClient["key"], { border: string; accent: string }> = {
  "connect-resend": { border: "#38bdf8", accent: "#0ea5e9" },
  "choose-mode": { border: "#a855f7", accent: "#7c3aed" },
  webhooks: { border: "#facc15", accent: "#eab308" },
  "send-test": { border: "#34d399", accent: "#059669" }
};

export default function OnboardingChecklist({ initialState, baseUrl }: Props) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialState.settings);
  const [modeChoice, setModeChoice] = useState<WorkspaceModeValue>(initialState.settings.mode);
  const [actionStatus, setActionStatus] = useState<Record<ActionKey, ActionStatus>>({
    "resend-test": { type: "idle" },
    "create-test-list": { type: "idle" },
    "send-test-broadcast": { type: "idle" },
    "run-poller": { type: "idle" },
    "update-mode": { type: "idle" }
  });
  const [pendingAction, startTransition] = useTransition();

  const steps = useMemo(() => deriveSteps(settings), [settings]);

  useEffect(() => {
    setModeChoice(settings.mode);
  }, [settings.mode]);

  const updateActionStatus = useCallback((key: ActionKey, status: ActionStatus) => {
    setActionStatus((prev) => ({ ...prev, [key]: status }));
  }, []);

  const refreshFromServer = useCallback(() => {
    startTransition(async () => {
      await router.refresh();
    });
  }, [router]);

  const handleResendTest = useCallback(async () => {
    updateActionStatus("resend-test", { type: "idle" });
    try {
      const response = await fetch("/api/integrations/resend/test", {
        method: "POST"
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data.message === "string" ? data.message : "Test failed");
      }

      setSettings((prev) => ({
        ...prev,
        hasResendApiKey: Boolean(data.hasResendApiKey),
        resendLastValidatedAt: data.resendLastValidatedAt
      }));
      updateActionStatus("resend-test", {
        type: "success",
        message: data.message ?? "Resend connection succeeded"
      });
      refreshFromServer();
    } catch (error) {
      updateActionStatus("resend-test", {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to test Resend connection"
      });
    }
  }, [refreshFromServer, updateActionStatus]);

  const handleUpdateMode = useCallback(async () => {
    updateActionStatus("update-mode", { type: "idle" });
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: modeChoice })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data.message === "string" ? data.message : "Unable to update mode";
        throw new Error(message);
      }

      setSettings((prev) => ({
        ...prev,
        mode: data.mode ?? prev.mode,
        testModeEnabled: data.testModeEnabled ?? prev.testModeEnabled,
        hasResendApiKey: data.hasResendApiKey ?? prev.hasResendApiKey
      }));
      updateActionStatus("update-mode", {
        type: "success",
        message: data.testModeEnabled ? "Test Mode enabled" : "Production Mode enabled"
      });
      refreshFromServer();
    } catch (error) {
      updateActionStatus("update-mode", {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to update mode"
      });
    }
  }, [modeChoice, refreshFromServer, updateActionStatus]);

  const invokeApi = useCallback(
    async (key: ActionKey, endpoint: string, label: string) => {
      updateActionStatus(key, { type: "idle" });
      try {
        const response = await fetch(endpoint, { method: "POST" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = typeof body.message === "string" ? body.message : `${label} failed`;
          throw new Error(message);
        }
        updateActionStatus(key, {
          type: "success",
          message: typeof body.message === "string" ? body.message : `${label} succeeded`
        });
        refreshFromServer();
      } catch (error) {
        updateActionStatus(key, {
          type: "error",
          message: error instanceof Error ? error.message : `${label} failed`
        });
      }
    },
    [refreshFromServer, updateActionStatus]
  );

  const handleCreateTestList = useCallback(() => {
    void invokeApi("create-test-list", "/api/test/create-list", "Create test list");
  }, [invokeApi]);

  const handleSendTestBroadcast = useCallback(() => {
    void invokeApi("send-test-broadcast", "/api/test/send-broadcast", "Send test broadcast");
  }, [invokeApi]);

  const handlePollStatus = useCallback(async () => {
    updateActionStatus("run-poller", { type: "idle" });
    try {
      const response = await fetch("/api/jobs/poll-email-status", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data.message === "string" ? data.message : "Polling failed";
        throw new Error(message);
      }

      const summary = data.summary ?? {};
      const message = `Checked ${summary.totalChecked ?? 0} messages | delivered: ${summary.delivered ?? 0}, bounced: ${summary.bounced ?? 0}, suppressed: ${summary.suppressed ?? 0}`;
      updateActionStatus("run-poller", { type: "success", message });
      refreshFromServer();
    } catch (error) {
      updateActionStatus("run-poller", {
        type: "error",
        message: error instanceof Error ? error.message : "Polling failed"
      });
    }
  }, [refreshFromServer, updateActionStatus]);

  const timelineItems = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [];
    if (settings.onboardingTestListCreatedAt) {
      items.push({
        label: "Test list created",
        value: formatTimestamp(settings.onboardingTestListCreatedAt)
      });
    }
    if (settings.onboardingTestBroadcastSentAt) {
      items.push({
        label: "Test broadcast sent",
        value: formatTimestamp(settings.onboardingTestBroadcastSentAt)
      });
    }
    if (settings.resendLastValidatedAt) {
      items.push({
        label: "Last Resend validation",
        value: formatTimestamp(settings.resendLastValidatedAt)
      });
    }
    return items;
  }, [settings]);

  const webhookUrl = useMemo(() => {
    if (typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin}/webhooks/resend`;
    }
    if (baseUrl) {
      return `${baseUrl.replace(/\/$/, "")}/webhooks/resend`;
    }
    return "/webhooks/resend";
  }, [baseUrl]);

  return (
    <section style={{ display: "grid", gap: "1.5rem" }}>
      {steps.map((step) => {
        const theme = STEP_THEME[step.key];
        const isPending = pendingAction && !step.completed;
        return (
          <article
            key={step.key}
            style={{
              border: `1px solid ${theme?.border ?? "#334155"}`,
              borderRadius: "1rem",
              padding: "1.75rem",
              background: "rgba(15, 23, 42, 0.85)",
              boxShadow: "0 20px 40px rgba(15, 23, 42, 0.35)",
              position: "relative"
            }}
          >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.15rem" }}>{step.title}</h2>
                <p style={{ marginTop: "0.35rem", color: "#94a3b8", lineHeight: 1.5 }}>{step.description}</p>
              </div>
              <span
                style={{
                  borderRadius: "999px",
                  padding: "0.35rem 0.9rem",
                  backgroundColor: step.completed ? "#22c55e" : "#334155",
                  color: step.completed ? "#052e16" : "#e2e8f0",
                  fontWeight: 600
                }}
              >
                {step.completed ? "Done" : step.optional ? "Optional" : "Pending"}
              </span>
            </header>
            <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              {step.key === "connect-resend" && (
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleResendTest}
                    style={{
                      padding: "0.75rem 1.5rem",
                      borderRadius: "0.75rem",
                      border: "none",
                      background: "linear-gradient(135deg, #38bdf8, #6366f1)",
                      color: "#0f172a",
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    {pendingAction ? "Testing..." : "Test connection"}
                  </button>
                  <a
                    href="/settings"
                    style={{
                      padding: "0.75rem 1.5rem",
                      borderRadius: "0.75rem",
                      border: "1px solid #334155",
                      color: "#e2e8f0",
                      textDecoration: "none"
                    }}
                  >
                    Open settings
                  </a>
                </div>
              )}

              {step.key === "choose-mode" && (
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    <label style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                      <input
                        type="radio"
                        name="workspace-mode"
                        value="TEST"
                        checked={modeChoice === "TEST"}
                        onChange={() => setModeChoice("TEST")}
                      />
                      <span>Test Mode (resend.dev inboxes only)</span>
                    </label>
                    <label style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                      <input
                        type="radio"
                        name="workspace-mode"
                        value="PRODUCTION"
                        checked={modeChoice === "PRODUCTION"}
                        onChange={() => setModeChoice("PRODUCTION")}
                      />
                      <span>Production Mode (requires verified domain)</span>
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={handleUpdateMode}
                      style={{
                        padding: "0.75rem 1.5rem",
                        borderRadius: "0.75rem",
                        border: "none",
                        background: "linear-gradient(135deg, #a855f7, #6366f1)",
                        color: "#0f172a",
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      Save mode
                    </button>
                    <span style={{ color: "#94a3b8" }}>
                      Current: {settings.mode} ({settings.testModeEnabled ? "Test Mode" : "Production Mode"})
                    </span>
                  </div>
                  <StatusBanner status={actionStatus["update-mode"]} />
                </div>
              )}

              {step.key === "webhooks" && (
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <div style={{ color: "#facc15" }}>
                    <p style={{ margin: 0 }}>
                      Webhooks are optional. The polling job handles outcomes while you set this up.
                    </p>
                  </div>
                  <div style={{ display: "grid", gap: "0.35rem", color: "#94a3b8" }}>
                    <span>Webhook URL</span>
                    <strong style={{ color: "#e2e8f0" }}>{webhookUrl}</strong>
                    <span>Status: {settings.webhookEnabled ? "Enabled" : "Disabled (recommended for early testing)"}</span>
                    <span>Last webhook received: {formatTimestamp(settings.webhookLastReceivedAt)}</span>
                  </div>
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                    <a
                      href="/settings"
                      style={{
                        padding: "0.65rem 1.25rem",
                        borderRadius: "0.75rem",
                        border: "1px solid #facc15",
                        color: "#facc15",
                        textDecoration: "none"
                      }}
                    >
                      Configure webhook secret
                    </a>
                  </div>
                </div>
              )}

              {step.key === "send-test" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={handleCreateTestList}
                      style={{
                        padding: "0.75rem 1.5rem",
                        borderRadius: "0.75rem",
                        border: "none",
                        background: "#34d399",
                        color: "#022c22",
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      Create test list
                    </button>
                    <button
                      type="button"
                      onClick={handleSendTestBroadcast}
                      style={{
                        padding: "0.75rem 1.5rem",
                        borderRadius: "0.75rem",
                        border: "1px solid #34d399",
                        background: "transparent",
                        color: "#34d399",
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      Send test broadcast
                    </button>
                    <button
                      type="button"
                      onClick={handlePollStatus}
                      style={{
                        padding: "0.75rem 1.5rem",
                        borderRadius: "0.75rem",
                        border: "1px solid #0ea5e9",
                        background: "transparent",
                        color: "#38bdf8",
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      Poll email status
                    </button>
                    <a
                      href="/dev"
                      style={{
                        padding: "0.75rem 1.5rem",
                        borderRadius: "0.75rem",
                        border: "1px solid #334155",
                        color: "#e2e8f0",
                        textDecoration: "none"
                      }}
                    >
                      Open dev tools
                    </a>
                  </div>
                  <div style={{ color: "#94a3b8" }}>
                    {timelineItems.length === 0 ? (
                      <p style={{ margin: 0 }}>Timeline pending: Run the actions above to populate delivery checkpoints.</p>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                        {timelineItems.map((item) => (
                          <li key={item.label}>
                            <strong>{item.label}:</strong> {item.value}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {step.lastCompletedAt && (
                <p style={{ margin: 0, color: "#64748b" }}>Last completed: {formatTimestamp(step.lastCompletedAt)}</p>
              )}

              {!step.completed && !step.optional && settings.encryptionEnabled === false && step.key === "connect-resend" && (
                <p style={{ margin: 0, color: "#f97316", fontWeight: 600 }}>
                  APP_ENCRYPTION_KEY is missing. Add it to your environment before storing the Resend API key.
                </p>
              )}

              {step.key === "connect-resend" && (
                <StatusBanner status={actionStatus["resend-test"]} />
              )}

              {step.key === "send-test" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <StatusBanner status={actionStatus["create-test-list"]} />
                  <StatusBanner status={actionStatus["send-test-broadcast"]} />
                  <StatusBanner status={actionStatus["run-poller"]} />
                </div>
              )}
            </div>

            {isPending && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "1rem",
                  background: "rgba(15, 23, 42, 0.35)",
                  pointerEvents: "none"
                }}
              />
            )}
          </article>
        );
      })}
    </section>
  );
}

type StatusBannerProps = {
  status: ActionStatus;
};

function StatusBanner({ status }: StatusBannerProps) {
  if (status.type === "idle") {
    return null;
  }

  const background = status.type === "success" ? "rgba(22, 163, 74, 0.15)" : "rgba(248, 113, 113, 0.15)";
  const border = status.type === "success" ? "1px solid rgba(22, 163, 74, 0.35)" : "1px solid rgba(248, 113, 113, 0.35)";
  const color = status.type === "success" ? "#bbf7d0" : "#fecaca";

  return (
    <div
      role="status"
      style={{
        borderRadius: "0.75rem",
        padding: "0.75rem 1rem",
        background,
        border,
        color,
        fontWeight: 500
      }}
    >
      {status.message}
    </div>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import { WORKSPACE_MODES, type WorkspaceModeValue } from "@/lib/workspace";

type InitialSettings = {
  mode: WorkspaceModeValue;
  testModeEnabled: boolean;
  hasResendApiKey: boolean;
  resendLastValidatedAt: string | null;
  webhookEnabled: boolean;
  webhookLastReceivedAt: string | null;
  encryptionEnabled: boolean;
};

type SettingsResponse = {
  mode: WorkspaceModeValue;
  hasResendApiKey: boolean;
  resendLastValidatedAt: string | null;
  encryptionEnabled: boolean;
  webhookEnabled: boolean;
  webhookLastReceivedAt: string | null;
};

type StatusState =
  | { type: "idle" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

const MODE_LABELS: Record<WorkspaceModeValue, string> = {
  TEST: "Test Mode (resend.dev inboxes only)",
  PRODUCTION: "Production Mode (requires verified domain)"
};

function formatIsoTimestamp(value: string | null): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  return date.toLocaleString();
}

export default function SettingsForm({ initialSettings }: { initialSettings: InitialSettings }) {
  const [mode, setMode] = useState<WorkspaceModeValue>(initialSettings.mode);
  const [savedMode, setSavedMode] = useState<WorkspaceModeValue>(initialSettings.mode);
  const [apiKey, setApiKey] = useState("");
  const [hasResendApiKey, setHasResendApiKey] = useState(initialSettings.hasResendApiKey);
  const [resendLastValidatedAt, setResendLastValidatedAt] = useState(initialSettings.resendLastValidatedAt);
  const [encryptionEnabledState, setEncryptionEnabledState] = useState(initialSettings.encryptionEnabled);
  const [webhookEnabled, setWebhookEnabled] = useState(initialSettings.webhookEnabled);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookLastReceivedAt, setWebhookLastReceivedAt] = useState(initialSettings.webhookLastReceivedAt);
  const [status, setStatus] = useState<StatusState>({ type: "idle" });
  const [isSaving, setIsSaving] = useState(false);

  const canSubmit = useMemo(() => {
    if (isSaving) {
      return false;
    }

    if (apiKey.trim().length > 0) {
      return true;
    }

    if (webhookSecret.trim().length > 0) {
      return true;
    }

    if (webhookEnabled !== initialSettings.webhookEnabled) {
      return true;
    }

    return mode !== savedMode;
  }, [apiKey, isSaving, mode, savedMode, webhookEnabled, webhookSecret, initialSettings.webhookEnabled]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!canSubmit) {
        return;
      }

      setIsSaving(true);
      setStatus({ type: "idle" });

      const payload: Record<string, unknown> = {
        mode
      };

      const trimmedKey = apiKey.trim();
      if (trimmedKey.length > 0) {
        payload.resendApiKey = trimmedKey;
      }

      const trimmedWebhookSecret = webhookSecret.trim();
      if (trimmedWebhookSecret.length > 0) {
        payload.webhookSecret = trimmedWebhookSecret;
      }

      payload.webhookEnabled = webhookEnabled;

      try {
        const response = await fetch("/api/settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const message = typeof body.message === "string" ? body.message : "Failed to update settings";
          throw new Error(message);
        }

        const json = (await response.json()) as SettingsResponse;

        setMode(json.mode);
        setSavedMode(json.mode);
        setHasResendApiKey(json.hasResendApiKey);
        setResendLastValidatedAt(json.resendLastValidatedAt);
        setEncryptionEnabledState(json.encryptionEnabled);
        setWebhookEnabled(json.webhookEnabled);
        setWebhookLastReceivedAt(json.webhookLastReceivedAt ?? null);
        setApiKey("");
        setWebhookSecret("");
        setStatus({ type: "success", message: "Settings saved" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update settings";
        setStatus({ type: "error", message });
      } finally {
        setIsSaving(false);
      }
    },
      [apiKey, canSubmit, mode, webhookEnabled, webhookSecret]
  );

  const secretStatus = hasResendApiKey ? "Stored" : "Not set";
  const webhookStatus = webhookEnabled ? "Enabled" : "Disabled";

  return (
    <section
      style={{
        backgroundColor: "#111827",
        borderRadius: "1rem",
        padding: "2rem",
        border: "1px solid #1f2937",
        boxShadow: "0 10px 30px rgba(15, 23, 42, 0.4)"
      }}
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div>
          <label htmlFor="mode" style={{ display: "block", fontWeight: 600, marginBottom: "0.5rem" }}>
            Workspace Mode
          </label>
          <select
            id="mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as WorkspaceModeValue)}
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "0.75rem",
              border: "1px solid #334155",
              backgroundColor: "#0f172a",
              color: "#e2e8f0",
              width: "100%"
            }}
          >
            {WORKSPACE_MODES.map((value) => (
              <option key={value} value={value}>
                {MODE_LABELS[value]}
              </option>
            ))}
          </select>
          <p style={{ marginTop: "0.5rem", color: "#94a3b8" }}>
            Test Mode keeps all sends within resend.dev inboxes. Production Mode requires a verified sending domain.
          </p>
        </div>

        <div>
          <label htmlFor="apiKey" style={{ display: "block", fontWeight: 600, marginBottom: "0.5rem" }}>
            Resend API Key
          </label>
          <input
            id="apiKey"
            type="password"
            value={apiKey}
            placeholder="re_live_..."
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "0.75rem",
              border: "1px solid #334155",
              backgroundColor: "#0f172a",
              color: "#e2e8f0",
              width: "100%"
            }}
          />
          <p style={{ marginTop: "0.5rem", color: "#94a3b8" }}>
            Status: {secretStatus}. Enter a new key to replace the stored secret. Keys are encrypted at rest and never logged.
          </p>
          {!encryptionEnabledState && (
            <p style={{ marginTop: "0.5rem", color: "#f97316", fontWeight: 600 }}>
              APP_ENCRYPTION_KEY is not set. Secrets will fail to save until encryption is configured.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="webhookSecret" style={{ display: "block", fontWeight: 600, marginBottom: "0.5rem" }}>
            Webhook Secret (optional)
          </label>
          <input
            id="webhookSecret"
            type="password"
            value={webhookSecret}
            placeholder="whsec_..."
            onChange={(event) => setWebhookSecret(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "0.75rem",
              border: "1px solid #334155",
              backgroundColor: "#0f172a",
              color: "#e2e8f0",
              width: "100%"
            }}
          />
          <p style={{ marginTop: "0.5rem", color: "#94a3b8" }}>
            Status: {webhookStatus}. Provide the shared secret from Resend webhooks to enable signature verification.
          </p>
          {!encryptionEnabledState && (
            <p style={{ marginTop: "0.5rem", color: "#f97316", fontWeight: 600 }}>
              APP_ENCRYPTION_KEY is not set. Secrets will fail to save until encryption is configured.
            </p>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <input
            id="webhookEnabled"
            type="checkbox"
            checked={webhookEnabled}
            onChange={(event) => setWebhookEnabled(event.target.checked)}
          />
          <label htmlFor="webhookEnabled" style={{ fontWeight: 600 }}>
            Enable webhooks (optional)
          </label>
        </div>

        <div style={{ color: "#94a3b8" }}>
          <p>Test Mode Enabled: {mode === "TEST" ? "Yes" : "No"}</p>
          <p>Last Connection Test: {formatIsoTimestamp(resendLastValidatedAt)}</p>
          <p>Last Webhook Received: {formatIsoTimestamp(webhookLastReceivedAt)}</p>
        </div>

        {status.type !== "idle" && (
          <div
            role="status"
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "0.75rem",
              backgroundColor: status.type === "success" ? "#065f46" : "#7f1d1d",
              color: "#f8fafc"
            }}
          >
            {status.message}
          </div>
        )}

        <div style={{ display: "flex", gap: "1rem" }}>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "9999px",
              border: "none",
              background: canSubmit ? "linear-gradient(135deg, #22d3ee, #6366f1)" : "#1e293b",
              color: "#0f172a",
              fontWeight: 600,
              cursor: canSubmit ? "pointer" : "not-allowed",
              transition: "transform 0.2s ease, box-shadow 0.2s ease",
              boxShadow: canSubmit ? "0 12px 30px rgba(99, 102, 241, 0.35)" : "none"
            }}
          >
            {isSaving ? "Saving..." : "Save settings"}
          </button>
          {hasResendApiKey && (
            <button
              type="button"
              onClick={async () => {
                setIsSaving(true);
                setStatus({ type: "idle" });
                try {
                  const response = await fetch("/api/settings", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ mode, resendApiKey: null })
                  });

                  if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    const message = typeof body.message === "string" ? body.message : "Failed to clear key";
                    throw new Error(message);
                  }

                  const json = (await response.json()) as SettingsResponse;

                  setHasResendApiKey(json.hasResendApiKey);
                  setSavedMode(json.mode);
                  setResendLastValidatedAt(json.resendLastValidatedAt);
                  setEncryptionEnabledState(json.encryptionEnabled);
                  setMode(json.mode);
                  setStatus({ type: "success", message: "Resend key cleared" });
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Failed to clear key";
                  setStatus({ type: "error", message });
                } finally {
                  setIsSaving(false);
                }
              }}
              disabled={isSaving}
              style={{
                padding: "0.75rem 1.5rem",
                borderRadius: "9999px",
                border: "1px solid #fb7185",
                background: "transparent",
                color: isSaving ? "#475569" : "#fca5a5",
                fontWeight: 600,
                cursor: isSaving ? "not-allowed" : "pointer"
              }}
            >
              Clear stored key
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

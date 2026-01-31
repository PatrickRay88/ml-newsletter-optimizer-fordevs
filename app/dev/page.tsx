"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ApiStatus = {
  type: "idle" | "loading" | "success" | "error";
  message?: string;
};

type Decision = {
  id: string;
  contactId: string;
  contactEmail: string | null;
  contactTags: string[];
  recommendedHour: number;
  score: number;
  baselineScore: number;
  segment: string;
  throttled: boolean;
  recommendedAt: string | null;
  createdAt: string;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeHourOfWeek(hour: number): string {
  const dayIndex = Math.floor(hour / 24) % 7;
  const hourOfDay = hour % 24;
  return `${DAY_LABELS[dayIndex]} ${hourOfDay.toString().padStart(2, "0")}:00`;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function maskEmail(email: string | null): string {
  if (!email) {
    return "unknown";
  }
  const [user, domain] = email.split("@");
  if (!user || !domain) {
    return email;
  }
  const maskedUser = user.length <= 3 ? `${user[0] ?? "*"}***` : `${user.slice(0, 3)}***`;
  return `${maskedUser}@${domain}`;
}

export default function DevUtilitiesPage() {
  const [useOptimizer, setUseOptimizer] = useState(true);
  const [status, setStatus] = useState<Record<string, ApiStatus>>({});
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [decisionsStatus, setDecisionsStatus] = useState<ApiStatus>({ type: "idle" });
  const [flowContact, setFlowContact] = useState("");
  const [flowEvent, setFlowEvent] = useState("user.signup");

  const updateStatus = useCallback((key: string, next: ApiStatus) => {
    setStatus((current) => ({ ...current, [key]: next }));
  }, []);

  const fetchDecisions = useCallback(async () => {
    setDecisionsStatus({ type: "loading" });
    try {
      const response = await fetch("/api/optimizer/decisions?limit=12");
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(typeof body.message === "string" ? body.message : "Failed to load decisions");
      }
      setDecisions(body.decisions as Decision[]);
      setDecisionsStatus({ type: "success", message: `Loaded ${body.decisions.length} decisions` });
    } catch (error) {
      setDecisionsStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load decisions"
      });
    }
  }, []);

  useEffect(() => {
    void fetchDecisions();
  }, [fetchDecisions]);

  const runPost = useCallback(
    async (key: string, endpoint: string, payload?: unknown) => {
      updateStatus(key, { type: "loading" });
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: payload ? { "Content-Type": "application/json" } : undefined,
          body: payload ? JSON.stringify(payload) : undefined
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.success === false) {
          const message = typeof body.message === "string" ? body.message : `Request to ${endpoint} failed`;
          throw new Error(message);
        }
        updateStatus(key, {
          type: "success",
          message: typeof body.message === "string" ? body.message : `${key} succeeded`
        });
        if (key.includes("broadcast")) {
          void fetchDecisions();
        }
      } catch (error) {
        updateStatus(key, {
          type: "error",
          message: error instanceof Error ? error.message : `${key} failed`
        });
      }
    },
    [fetchDecisions, updateStatus]
  );

  const actionButtons = useMemo(
    () => [
      {
        key: "create-list",
        label: "Create Test List",
        description: "Seed deterministic resend.dev contacts for the demo inbox.",
        onClick: () => runPost("create-list", "/api/test/create-list")
      },
      {
        key: "send-broadcast-optimized",
        label: "Send Broadcast (Optimizer)",
        description: "Queue the onboarding broadcast using optimizer recommendations.",
        onClick: () =>
          runPost("send-broadcast-optimized", "/api/test/send-broadcast", { useOptimizer: true })
      },
      {
        key: "send-broadcast-manual",
        label: "Send Broadcast (Immediate)",
        description: "Force immediate send without optimizer scheduling.",
        onClick: () =>
          runPost("send-broadcast-manual", "/api/test/send-broadcast", { useOptimizer: false })
      },
      {
        key: "poll-outcomes",
        label: "Poll Email Status",
        description: "Invoke the status poller to reconcile delivery outcomes.",
        onClick: () => runPost("poll-outcomes", "/api/jobs/poll-email-status")
      },
      {
        key: "hygiene-sweep",
        label: "Run Hygiene Sweep",
        description: "Score contacts for risk and auto-suppress high-risk records.",
        onClick: () => runPost("hygiene-sweep", "/api/jobs/hygiene-scan")
      },
      {
        key: "process-flows",
        label: "Process Flow Runs",
        description: "Advance due flow steps and schedule/resume lifecycle sends.",
        onClick: () => runPost("process-flows", "/api/jobs/process-flows")
      }
    ],
    [runPost]
  );

  return (
    <main style={{ padding: "3rem", display: "grid", gap: "2rem" }}>
      <section style={{ display: "grid", gap: "1rem" }}>
        <header>
          <h1 style={{ marginBottom: "0.5rem" }}>Developer Utilities</h1>
          <p style={{ margin: 0, color: "#94a3b8" }}>
            Run deterministic demo workflows and inspect optimizer activity. All actions operate in Test Mode.
          </p>
        </header>
        <div style={{ display: "grid", gap: "1rem" }}>
          {actionButtons.map((action) => {
            const actionState = status[action.key] ?? { type: "idle" };
            const disabled = actionState.type === "loading";
            return (
              <div
                key={action.key}
                style={{
                  border: "1px solid #1f2937",
                  borderRadius: "0.75rem",
                  padding: "1rem 1.25rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1.5rem",
                  background: "#0f172a"
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{action.label}</h2>
                  <p style={{ margin: "0.35rem 0 0", color: "#64748b" }}>{action.description}</p>
                  {actionState.type !== "idle" && actionState.message && (
                    <p
                      style={{
                        marginTop: "0.5rem",
                        color: actionState.type === "error" ? "#f87171" : "#10b981"
                      }}
                    >
                      {actionState.message}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={action.onClick}
                  disabled={disabled}
                  style={{
                    padding: "0.75rem 1.5rem",
                    borderRadius: "999px",
                    border: "none",
                    background: disabled ? "#1f2937" : "#38bdf8",
                    color: disabled ? "#475569" : "#0f172a",
                    fontWeight: 600,
                    cursor: disabled ? "default" : "pointer"
                  }}
                >
                  {disabled ? "Running..." : "Run"}
                </button>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: "1rem",
            border: "1px solid #1f2937",
            borderRadius: "0.75rem",
            padding: "1rem 1.25rem",
            background: "#0f172a",
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "center"
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", flex: "1 1 220px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span>Contact Email</span>
              <input
                value={flowContact}
                onChange={(event) => setFlowContact(event.target.value)}
                placeholder="demo+001@resend.dev"
                style={{ padding: "0.6rem", borderRadius: "0.6rem", background: "#0b1220", color: "#e2e8f0", border: "1px solid #1f2937" }}
              />
            </label>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", flex: "1 1 180px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span>Event Name</span>
              <input
                value={flowEvent}
                onChange={(event) => setFlowEvent(event.target.value)}
                placeholder="user.signup"
                style={{ padding: "0.6rem", borderRadius: "0.6rem", background: "#0b1220", color: "#e2e8f0", border: "1px solid #1f2937" }}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!flowContact.trim() || !flowEvent.trim()) {
                updateStatus("trigger-flow", {
                  type: "error",
                  message: "Provide contact email and event"
                });
                return;
              }
              runPost("trigger-flow", "/api/events", {
                contactEmail: flowContact.trim(),
                eventName: flowEvent.trim()
              });
            }}
            style={{
              padding: "0.6rem 1.4rem",
              borderRadius: "0.75rem",
              border: "1px solid #1f2937",
              background: "#111827",
              color: "#38bdf8",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Trigger Flow Event
          </button>
          {status["trigger-flow"] && status["trigger-flow"].type !== "idle" && (
            <span
              style={{
                color: status["trigger-flow"].type === "error" ? "#f87171" : "#34d399",
                fontWeight: 600
              }}
            >
              {status["trigger-flow"].message}
            </span>
          )}
        </div>
      </section>

      <section style={{ display: "grid", gap: "1rem" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0 }}>Optimizer Decisions</h2>
            <p style={{ margin: "0.35rem 0 0", color: "#64748b" }}>
              Recent recommendations with segment context, scores, and scheduled windows.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#cbd5f5" }}>
              <input
                type="checkbox"
                checked={useOptimizer}
                onChange={(event) => setUseOptimizer(event.target.checked)}
              />
              Default optimizer on
            </label>
            <button
              type="button"
              onClick={() => runPost("send-broadcast-toggle", "/api/test/send-broadcast", {
                useOptimizer
              })}
              style={{
                padding: "0.6rem 1.25rem",
                borderRadius: "0.75rem",
                border: "1px solid #1f2937",
                background: "#111827",
                color: "#f8fafc",
                cursor: "pointer",
                fontWeight: 600
              }}
            >
              Send using toggle
            </button>
            <button
              type="button"
              onClick={() => void fetchDecisions()}
              style={{
                padding: "0.6rem 1.25rem",
                borderRadius: "0.75rem",
                border: "1px solid #1f2937",
                background: "#111827",
                color: "#38bdf8",
                cursor: "pointer",
                fontWeight: 600
              }}
            >
              Refresh
            </button>
          </div>
        </header>
        {status["send-broadcast-toggle"] && status["send-broadcast-toggle"].type !== "idle" && (
          <p
            style={{
              margin: 0,
              color:
                status["send-broadcast-toggle"].type === "error"
                  ? "#f87171"
                  : "#10b981"
            }}
          >
            {status["send-broadcast-toggle"].message ?? "Broadcast triggered"}
          </p>
        )}
        {status["hygiene-sweep"] && status["hygiene-sweep"].type !== "idle" && (
          <p
            style={{
              margin: 0,
              color:
                status["hygiene-sweep"].type === "error"
                  ? "#f87171"
                  : "#10b981"
            }}
          >
            {status["hygiene-sweep"].message ?? "Hygiene sweep complete"}
          </p>
        )}

        <div
          style={{
            border: "1px solid #1f2937",
            borderRadius: "0.75rem",
            background: "#0f172a",
            overflow: "hidden"
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ background: "#111827", color: "#cbd5f5" }}>
              <tr>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>Contact</th>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>Segment</th>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>Recommended Hour</th>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>Scheduled For</th>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>Score</th>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>Baseline</th>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>Throttled</th>
                <th style={{ textAlign: "left", padding: "0.75rem" }}>Generated</th>
              </tr>
            </thead>
            <tbody>
                    {decisions.length === 0 ? (
                <tr>
                  <td style={{ padding: "1rem", textAlign: "center", color: "#64748b" }} colSpan={8}>
                    {decisionsStatus.type === "loading" ? "Loading decisions..." : "No optimizer decisions logged yet."}
                  </td>
                </tr>
              ) : (
                decisions.map((decision) => (
                  <tr key={decision.id} style={{ borderTop: "1px solid #1f2937", color: "#e2e8f0" }}>
                    <td style={{ padding: "0.75rem" }}>
                      <div style={{ fontWeight: 600 }}>{maskEmail(decision.contactEmail)}</div>
                      <div style={{ color: "#64748b", fontSize: "0.8rem" }}>{decision.contactId}</div>
                    </td>
                    <td style={{ padding: "0.75rem" }}>{decision.segment}</td>
                    <td style={{ padding: "0.75rem" }}>{describeHourOfWeek(decision.recommendedHour)}</td>
                    <td style={{ padding: "0.75rem" }}>{formatTimestamp(decision.recommendedAt)}</td>
                    <td style={{ padding: "0.75rem" }}>{decision.score.toFixed(3)}</td>
                    <td style={{ padding: "0.75rem" }}>{decision.baselineScore.toFixed(3)}</td>
                    <td style={{ padding: "0.75rem" }}>{decision.throttled ? "Yes" : "No"}</td>
                    <td style={{ padding: "0.75rem" }}>{formatTimestamp(decision.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {decisionsStatus.type === "error" && decisionsStatus.message && (
          <p style={{ margin: 0, color: "#f87171" }}>{decisionsStatus.message}</p>
        )}
      </section>
    </main>
  );
}

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

type ModelSummary = {
  id: string;
  modelName?: string;
  trainedAt: string | null;
  metrics: unknown;
  metadata: unknown;
  predictionCount: number;
  sampleCount?: number;
  classificationThreshold?: number | null;
  trend?: Array<{
    modelName: string;
    trainedAt: string;
    sampleCount: number;
    auc: number | null;
    prAuc: number | null;
    logLoss: number | null;
    brierScore: number | null;
    threshold: number | null;
  }>;
  decisionCountSinceTraining?: number;
  decisionCountTotal?: number;
  expectedScorePct?: number | null;
  expectedBaselinePct?: number | null;
  expectedUpliftPct?: number | null;
  pooledPerformance?: {
    pooledBroadcasts: number;
    sentMessages: number;
    optimizedMessages: number;
    controlMessages?: number;
    treatedMessages?: number;
    assignedMessages?: number;
    optimizationCoveragePct: number;
    assignmentCoveragePct?: number;
    deliveredOptimized: number;
    clickedOptimized: number;
    deliveredControl: number;
    clickedControl: number;
    actualCtrPct: number;
    controlCtrPct: number;
    baselineCtrPct: number | null;
    baselineSamples: number;
    upliftVsControlPct: number | null;
    upliftVsBaselinePct: number | null;
    status: "warming_up" | "insufficient_data" | "no_baseline" | "healthy" | "underperforming";
    statusNote: string;
  };
};

type ModelSummaryResponse = {
  sendTime: ModelSummary | null;
  hygiene: ModelSummary | null;
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

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(2)}%`;
}

function statusLabel(value: ModelSummary["pooledPerformance"] extends { status: infer T } ? T : never): string {
  if (value === "healthy") {
    return "Healthy";
  }
  if (value === "underperforming") {
    return "Underperforming";
  }
  if (value === "warming_up") {
    return "Warming Up";
  }
  if (value === "no_baseline") {
    return "No Baseline";
  }
  return "Insufficient Data";
}

export default function DevUtilitiesPage() {
  const [useOptimizer, setUseOptimizer] = useState(true);
  const [status, setStatus] = useState<Record<string, ApiStatus>>({});
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [decisionsStatus, setDecisionsStatus] = useState<ApiStatus>({ type: "idle" });
  const [modelSummary, setModelSummary] = useState<ModelSummaryResponse>({ sendTime: null, hygiene: null });
  const [modelStatus, setModelStatus] = useState<ApiStatus>({ type: "idle" });
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

  const fetchModelSummary = useCallback(async () => {
    setModelStatus({ type: "loading" });
    try {
      const response = await fetch("/api/models/summary");
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(typeof body.message === "string" ? body.message : "Failed to load model summary");
      }
      setModelSummary(body.models as ModelSummaryResponse);
      setModelStatus({ type: "success", message: "Model summary updated" });
    } catch (error) {
      setModelStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load model summary"
      });
    }
  }, []);

  useEffect(() => {
    void fetchDecisions();
    void fetchModelSummary();
  }, [fetchDecisions, fetchModelSummary]);

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
        if (key.includes("train-models") || key.includes("train-real-models")) {
          void fetchModelSummary();
        }
      } catch (error) {
        updateStatus(key, {
          type: "error",
          message: error instanceof Error ? error.message : `${key} failed`
        });
      }
    },
    [fetchDecisions, fetchModelSummary, updateStatus]
  );

  const actionButtons = useMemo(
    () => [
      {
        key: "create-list",
        label: "Create Test List",
        description: "Seed deterministic resend.dev contacts for the demo inbox.",
        onClick: () => runPost("create-list", "/api/test/create-list"),
        walkthroughKey: "dev-create-list"
      },
      {
        key: "send-broadcast-optimized",
        label: "Send Broadcast (Optimizer)",
        description: "Queue the onboarding broadcast using optimizer recommendations.",
        onClick: () =>
          runPost("send-broadcast-optimized", "/api/test/send-broadcast", { useOptimizer: true }),
        walkthroughKey: "dev-send-broadcast"
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
        onClick: () => runPost("poll-outcomes", "/api/jobs/poll-email-status"),
        walkthroughKey: "dev-poll-outcomes"
      },
      {
        key: "hygiene-sweep",
        label: "Run Hygiene Sweep",
        description: "Score contacts for risk and auto-suppress high-risk records.",
        onClick: () => runPost("hygiene-sweep", "/api/jobs/hygiene-scan"),
        walkthroughKey: "dev-hygiene-sweep"
      },
      {
        key: "train-models",
        label: "Train ML Models",
        description: "Recompute send-time histograms and hygiene risk model.",
        onClick: () => runPost("train-models", "/api/jobs/train-models"),
        walkthroughKey: "dev-train-models"
      },
      {
        key: "train-real-models",
        label: "Train Real ML Models",
        description: "Train sklearn models from pooled outcomes and persist artifacts + model versions.",
        onClick: () => runPost("train-real-models", "/api/jobs/train-real-models")
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
            Run deterministic demo workflows and inspect optimizer activity. All actions operate in Sandbox.
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
                  data-walkthrough={action.walkthroughKey}
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

        <section
          style={{
            marginTop: "1.5rem",
            border: "1px solid #1f2937",
            borderRadius: "0.75rem",
            padding: "1rem 1.25rem",
            background: "#0f172a",
            display: "grid",
            gap: "0.75rem"
          }}
        >
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Model Training Summary</h2>
              <p style={{ margin: "0.35rem 0 0", color: "#64748b" }}>
                Latest trained models and model-specific telemetry.
              </p>
            </div>
            <button
              type="button"
              onClick={fetchModelSummary}
              disabled={modelStatus.type === "loading"}
              style={{
                padding: "0.6rem 1.2rem",
                borderRadius: "999px",
                border: "none",
                background: modelStatus.type === "loading" ? "#1f2937" : "#38bdf8",
                color: modelStatus.type === "loading" ? "#475569" : "#0f172a",
                fontWeight: 600,
                cursor: modelStatus.type === "loading" ? "default" : "pointer"
              }}
            >
              {modelStatus.type === "loading" ? "Refreshing..." : "Refresh"}
            </button>
          </header>
          {modelStatus.type !== "idle" && modelStatus.message && (
            <p style={{ margin: 0, color: modelStatus.type === "error" ? "#f87171" : "#10b981" }}>
              {modelStatus.message}
            </p>
          )}
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {([
              { key: "sendTime", label: "Send-Time Optimizer" },
              { key: "hygiene", label: "Hygiene Risk Model" }
            ] as const).map((entry) => {
              const model = modelSummary[entry.key];
              return (
                <div
                  key={entry.key}
                  style={{
                    border: "1px solid #1f2937",
                    borderRadius: "0.6rem",
                    padding: "0.85rem",
                    background: "#0b1220"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{entry.label}</strong>
                    <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                      {model?.trainedAt ? `Trained ${formatTimestamp(model.trainedAt)}` : "Not trained"}
                    </span>
                  </div>
                  <div style={{ marginTop: "0.4rem", color: "#cbd5f5", fontSize: "0.9rem" }}>
                    {entry.key === "sendTime" ? (
                      <>
                        <div>Model family: {model?.modelName ?? "—"}</div>
                        <div>
                          Status: {model?.pooledPerformance ? statusLabel(model.pooledPerformance.status) : "—"}
                        </div>
                        <div style={{ color: "#94a3b8" }}>
                          {model?.pooledPerformance?.statusNote ?? "No optimizer telemetry yet"}
                        </div>
                        <div>Message samples: {model?.sampleCount ?? 0}</div>
                        <div>Classification threshold: {formatPercent(model?.classificationThreshold !== null && model?.classificationThreshold !== undefined ? model.classificationThreshold * 100 : null)}</div>
                        <div>Expected CTR (optimizer): {formatPercent(model?.expectedScorePct)}</div>
                        <div>Expected CTR (baseline): {formatPercent(model?.expectedBaselinePct)}</div>
                        <div>Expected uplift: {formatPercent(model?.expectedUpliftPct)}</div>
                        <div>Pooled broadcasts: {model?.pooledPerformance?.pooledBroadcasts ?? 0}</div>
                        <div>
                          Cohorts: optimized {model?.pooledPerformance?.optimizedMessages ?? 0}, control {model?.pooledPerformance?.controlMessages ?? 0}, treated {model?.pooledPerformance?.treatedMessages ?? 0}
                        </div>
                        <div>
                          Assignment coverage: {formatPercent(model?.pooledPerformance?.assignmentCoveragePct ?? model?.pooledPerformance?.optimizationCoveragePct)} ({model?.pooledPerformance?.assignedMessages ?? 0}/{model?.pooledPerformance?.sentMessages ?? 0} sent messages)
                        </div>
                        <div>
                          Realized CTR (optimized cohort): {formatPercent(model?.pooledPerformance?.actualCtrPct)} ({model?.pooledPerformance?.clickedOptimized ?? 0}/{model?.pooledPerformance?.deliveredOptimized ?? 0})
                        </div>
                        <div>
                          Realized CTR (control cohort): {formatPercent(model?.pooledPerformance?.controlCtrPct)} ({model?.pooledPerformance?.clickedControl ?? 0}/{model?.pooledPerformance?.deliveredControl ?? 0})
                        </div>
                        <div>Realized uplift (optimized vs control cohorts): {formatPercent(model?.pooledPerformance?.upliftVsControlPct)}</div>
                        <div>
                          Baseline CTR (synthetic): {formatPercent(model?.pooledPerformance?.baselineCtrPct)} ({model?.pooledPerformance?.baselineSamples ?? 0} samples)
                        </div>
                        <div>Realized uplift vs baseline: {formatPercent(model?.pooledPerformance?.upliftVsBaselinePct)}</div>
                        <div>Optimizer decisions (since training): {model?.decisionCountSinceTraining ?? 0}</div>
                        <div>Optimizer decisions (total): {model?.decisionCountTotal ?? 0}</div>
                        {(model?.trend?.length ?? 0) > 0 && (
                          <div style={{ marginTop: "0.45rem", display: "grid", gap: "0.2rem", color: "#94a3b8" }}>
                            <strong style={{ color: "#cbd5f5" }}>Recent performance trend</strong>
                            {model?.trend?.slice(0, 5).map((point) => (
                              <div key={`${point.modelName}-${point.trainedAt}`}>
                                {formatTimestamp(point.trainedAt)} • AUC {formatPercent(point.auc !== null ? point.auc * 100 : null)} • PR-AUC {formatPercent(point.prAuc !== null ? point.prAuc * 100 : null)} • LogLoss {point.logLoss !== null && Number.isFinite(point.logLoss) ? point.logLoss.toFixed(4) : "—"}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div>Model family: {model?.modelName ?? "—"}</div>
                        <div>Predictions: {model?.predictionCount ?? 0}</div>
                        <div>Contact samples: {model?.sampleCount ?? 0}</div>
                        <div>Classification threshold: {formatPercent(model?.classificationThreshold !== null && model?.classificationThreshold !== undefined ? model.classificationThreshold * 100 : null)}</div>
                        {(model?.trend?.length ?? 0) > 0 && (
                          <div style={{ marginTop: "0.45rem", display: "grid", gap: "0.2rem", color: "#94a3b8" }}>
                            <strong style={{ color: "#cbd5f5" }}>Recent performance trend</strong>
                            {model?.trend?.slice(0, 5).map((point) => (
                              <div key={`${point.modelName}-${point.trainedAt}`}>
                                {formatTimestamp(point.trainedAt)} • AUC {formatPercent(point.auc !== null ? point.auc * 100 : null)} • PR-AUC {formatPercent(point.prAuc !== null ? point.prAuc * 100 : null)} • LogLoss {point.logLoss !== null && Number.isFinite(point.logLoss) ? point.logLoss.toFixed(4) : "—"}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    <div>Model ID: {model?.id ?? "—"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

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

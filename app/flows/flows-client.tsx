"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FlowRunStatus, FlowStatus, FlowStepType } from "@prisma/client";
import type { FlowOverview } from "@/lib/flows";

const CARD_STYLE: React.CSSProperties = {
  border: "1px solid #1e293b",
  borderRadius: "1rem",
  padding: "1.5rem",
  background: "rgba(15, 23, 42, 0.9)",
  display: "grid",
  gap: "1rem"
};

const TABLE_HEADER_STYLE: React.CSSProperties = {
  background: "#111827",
  color: "#cbd5f5",
  textAlign: "left",
  padding: "0.6rem"
};

const TABLE_CELL_STYLE: React.CSSProperties = {
  padding: "0.6rem",
  borderTop: "1px solid #1f2937"
};

type FlowsClientProps = {
  flows: FlowOverview[];
  templates: Array<{ id: string; name: string; subject: string }>;
  segments: Array<{ id: string; name: string; isSystem: boolean }>;
};

type CreateStatus = {
  type: "idle" | "loading" | "success" | "error";
  message?: string;
};

type FlowTemplatePreset = {
  key: string;
  title: string;
  description: string;
  triggerEvent: string;
  delayMinutes: number;
  templateHint: string;
};

const FLOW_TEMPLATES: FlowTemplatePreset[] = [
  {
    key: "onboarding",
    title: "Onboarding (3 steps)",
    description: "Welcome immediately, then guide activation over the next day.",
    triggerEvent: "user.signup",
    delayMinutes: 60,
    templateHint: "Welcome"
  },
  {
    key: "activation",
    title: "Activation nudge",
    description: "Encourage first key action within the first 24 hours.",
    triggerEvent: "user.signup",
    delayMinutes: 180,
    templateHint: "Getting started"
  },
  {
    key: "reengage",
    title: "Re-engage 7d",
    description: "Reconnect inactive users after one week of no activity.",
    triggerEvent: "user.inactive_7d",
    delayMinutes: 0,
    templateHint: "Feature highlight"
  },
  {
    key: "winback",
    title: "Winback 30d",
    description: "Bring dormant accounts back with a clear CTA.",
    triggerEvent: "user.inactive_30d",
    delayMinutes: 0,
    templateHint: "Winback"
  }
];

function formatTimestamp(value: string | Date | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString();
}

function describeStep(step: { type: FlowStepType; config: unknown }, flow: FlowOverview): string {
  const base = step.config && typeof step.config === "object" ? (step.config as Record<string, unknown>) : {};
  switch (step.type) {
    case "TRIGGER": {
      const eventName = typeof base.eventName === "string" ? base.eventName : flow.triggerEventName;
      return `Trigger • ${eventName}`;
    }
    case "DELAY": {
      const minutes = typeof base.minutes === "number" ? base.minutes : flow.delayMinutes ?? 0;
      return minutes > 0 ? `Delay • ${minutes} minute${minutes === 1 ? "" : "s"}` : "Delay • immediate";
    }
    case "SEGMENT_FILTER": {
      const segmentId = typeof base.segmentId === "string" ? base.segmentId : flow.segmentId ?? "";
      const segmentLabel = (flow.segment?.name ?? segmentId) || "All contacts";
      return `Segment Filter • ${segmentLabel}`;
    }
    case "SEND_TEMPLATE": {
      return `Send Template • ${flow.template?.name ?? "Unknown template"}`;
    }
    default:
      return String(step.type).replace(/_/g, " ");
  }
}

function badgeColor(status: FlowStatus): string {
  if (status === "ACTIVE") {
    return "#34d399";
  }
  if (status === "PAUSED") {
    return "#fbbf24";
  }
  return "#94a3b8";
}

function runStatusColor(status: FlowRunStatus): string {
  switch (status) {
    case "COMPLETED":
      return "#34d399";
    case "CANCELLED":
      return "#f87171";
    case "FAILED":
      return "#f97316";
    default:
      return "#38bdf8";
  }
}

export default function FlowsClient({ flows, templates, segments }: FlowsClientProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [eventName, setEventName] = useState("user.signup");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [delayMinutes, setDelayMinutes] = useState("60");
  const [segmentId, setSegmentId] = useState("");
  const [useOptimizer, setUseOptimizer] = useState(true);
  const [status, setStatus] = useState<FlowStatus>("ACTIVE");
  const [createStatus, setCreateStatus] = useState<CreateStatus>({ type: "idle" });
  const [updating, setUpdating] = useState<Record<string, boolean>>({});

  const applyTemplatePreset = useCallback((preset: FlowTemplatePreset) => {
    setName(preset.title.replace(/\s+\(.*\)$/, ""));
    setEventName(preset.triggerEvent);
    setDelayMinutes(String(preset.delayMinutes));
    const matchedTemplate = templates.find((template) =>
      template.name.toLowerCase().includes(preset.templateHint.toLowerCase())
    );
    if (matchedTemplate) {
      setTemplateId(matchedTemplate.id);
    }
    setSegmentId("");
    setUseOptimizer(true);
    setStatus("ACTIVE");
  }, [templates]);

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !eventName.trim() || !templateId) {
      setCreateStatus({ type: "error", message: "Provide name, trigger event, and template" });
      return;
    }

    setCreateStatus({ type: "loading" });
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        triggerEventName: eventName.trim(),
        templateId
      };

      const parsedDelay = Number(delayMinutes);
      if (!Number.isNaN(parsedDelay) && parsedDelay >= 0) {
        payload.delayMinutes = parsedDelay;
      }

      if (segmentId) {
        payload.segmentId = segmentId;
      }

      payload.useOptimizer = useOptimizer;
      payload.status = status;

      const response = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.success === false) {
        const message = typeof body.message === "string" ? body.message : "Failed to create flow";
        throw new Error(message);
      }

      setCreateStatus({ type: "success", message: "Flow created" });
      setName("");
      setEventName("user.signup");
      setDelayMinutes("60");
      setSegmentId("");
      setUseOptimizer(true);
      setStatus("ACTIVE");
      setTemplateId(templates[0]?.id ?? "");
      router.refresh();
    } catch (error) {
      setCreateStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to create flow"
      });
    }
  }, [delayMinutes, eventName, name, router, segmentId, status, templateId, templates, useOptimizer]);

  const handleStatusChange = useCallback(async (flowId: string, next: FlowStatus) => {
    setUpdating((current) => ({ ...current, [flowId]: true }));
    try {
      const response = await fetch(`/api/flows/${flowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) {
        const message = typeof body.message === "string" ? body.message : "Failed to update flow";
        throw new Error(message);
      }
      router.refresh();
    } catch (error) {
      setCreateStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Flow update failed"
      });
    } finally {
      setUpdating((current) => ({ ...current, [flowId]: false }));
    }
  }, [router]);

  const flowCards = useMemo(() => flows.map((flow) => {
    const stepItems = flow.steps.map((step) => describeStep(step, flow));
    const pendingRuns = flow.runs.filter((run) => run.status !== "COMPLETED" && run.status !== "CANCELLED" && run.status !== "FAILED");
    return { flow, stepItems, pendingRuns };
  }), [flows]);

  return (
    <main style={{ padding: "2.5rem", display: "grid", gap: "2rem" }}>
      <section style={{ display: "grid", gap: "1rem" }}>
        <header>
          <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Lifecycle Flows</h1>
          <p style={{ margin: "0.4rem 0 0", color: "#94a3b8" }}>
            Start from a recommended template, then customize triggers, delays, and ML toggles.
          </p>
        </header>
        <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {FLOW_TEMPLATES.map((preset) => (
            <article key={preset.key} style={{ ...CARD_STYLE, background: "rgba(15, 23, 42, 0.75)" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.15rem" }}>{preset.title}</h2>
                <p style={{ margin: "0.35rem 0 0", color: "#94a3b8" }}>{preset.description}</p>
              </div>
              <dl style={{ margin: 0, display: "grid", gap: "0.35rem" }}>
                <div>
                  <strong>Trigger:</strong> {preset.triggerEvent}
                </div>
                <div>
                  <strong>Delay:</strong> {preset.delayMinutes ? `${preset.delayMinutes} minutes` : "Immediate"}
                </div>
                <div>
                  <strong>Template:</strong> {preset.templateHint}
                </div>
              </dl>
              <button
                type="button"
                onClick={() => applyTemplatePreset(preset)}
                style={{
                  padding: "0.55rem 1rem",
                  borderRadius: "0.65rem",
                  border: "1px solid #38bdf8",
                  background: "transparent",
                  color: "#38bdf8",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Use template
              </button>
            </article>
          ))}
        </div>
      </section>

      <section style={{ display: "grid", gap: "1rem", border: "1px solid #1f2937", borderRadius: "1rem", padding: "1.5rem", background: "#0f172a" }}>
        <header>
          <h2 style={{ margin: 0, fontSize: "1.35rem" }}>Create Flow</h2>
          <p style={{ margin: "0.4rem 0 0", color: "#94a3b8" }}>
            Define event-triggered automations with optional delays, segment filters, and optimizer-aware sends.
          </p>
        </header>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Welcome nurture"
                style={{ padding: "0.6rem", borderRadius: "0.6rem", background: "#0b1220", color: "#e2e8f0", border: "1px solid #1f2937" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span>Trigger Event</span>
              <input
                value={eventName}
                onChange={(event) => setEventName(event.target.value)}
                placeholder="user.signup"
                style={{ padding: "0.6rem", borderRadius: "0.6rem", background: "#0b1220", color: "#e2e8f0", border: "1px solid #1f2937" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span>Template</span>
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                style={{ padding: "0.6rem", borderRadius: "0.6rem", background: "#0b1220", color: "#e2e8f0", border: "1px solid #1f2937" }}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} — {template.subject}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span>Delay (minutes)</span>
              <input
                value={delayMinutes}
                onChange={(event) => setDelayMinutes(event.target.value)}
                type="number"
                min={0}
                placeholder="60"
                style={{ padding: "0.6rem", borderRadius: "0.6rem", background: "#0b1220", color: "#e2e8f0", border: "1px solid #1f2937" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span>Segment Filter</span>
              <select
                value={segmentId}
                onChange={(event) => setSegmentId(event.target.value)}
                style={{ padding: "0.6rem", borderRadius: "0.6rem", background: "#0b1220", color: "#e2e8f0", border: "1px solid #1f2937" }}
              >
                <option value="">All contacts</option>
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}{segment.isSystem ? " (system)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as FlowStatus)}
                style={{ padding: "0.6rem", borderRadius: "0.6rem", background: "#0b1220", color: "#e2e8f0", border: "1px solid #1f2937" }}
              >
                {Object.values(FlowStatus).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem" }}>
              <input
                type="checkbox"
                checked={useOptimizer}
                onChange={(event) => setUseOptimizer(event.target.checked)}
              />
              Use send-time optimizer
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", color: "#94a3b8" }}>
              <span>ML modules</span>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <span style={{ padding: "0.15rem 0.6rem", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", color: "#38bdf8", fontSize: "0.8rem" }}>
                  Send-time optimizer
                </span>
                <span style={{ padding: "0.15rem 0.6rem", borderRadius: "999px", background: "rgba(148, 163, 184, 0.2)", color: "#94a3b8", fontSize: "0.8rem" }}>
                  Hygiene scoring (soon)
                </span>
                <span style={{ padding: "0.15rem 0.6rem", borderRadius: "999px", background: "rgba(148, 163, 184, 0.2)", color: "#94a3b8", fontSize: "0.8rem" }}>
                  Experiments (soon)
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button
              type="button"
              onClick={handleCreate}
              disabled={createStatus.type === "loading"}
              style={{
                padding: "0.75rem 1.75rem",
                borderRadius: "0.75rem",
                border: "none",
                background: createStatus.type === "loading" ? "#1f2937" : "#38bdf8",
                color: createStatus.type === "loading" ? "#475569" : "#0f172a",
                fontWeight: 600,
                cursor: createStatus.type === "loading" ? "default" : "pointer"
              }}
            >
              {createStatus.type === "loading" ? "Creating..." : "Create flow"}
            </button>
            {createStatus.type !== "idle" && createStatus.message && (
              <span style={{ color: createStatus.type === "error" ? "#f87171" : "#34d399" }}>{createStatus.message}</span>
            )}
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gap: "1.5rem" }}>
        {flowCards.length === 0 ? (
          <p style={{ color: "#94a3b8" }}>No flows defined yet. Create one to start automation.</p>
        ) : (
          flowCards.map(({ flow, stepItems, pendingRuns }) => (
            <article key={flow.id} style={CARD_STYLE}>
              <header style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <h2 style={{ margin: 0, fontSize: "1.35rem" }}>{flow.name}</h2>
                  <span
                    style={{
                      padding: "0.2rem 0.6rem",
                      borderRadius: "999px",
                      background: badgeColor(flow.status),
                      color: "#022c22",
                      fontWeight: 600,
                      fontSize: "0.85rem"
                    }}
                  >
                    {flow.status}
                  </span>
                  <span style={{ color: "#64748b" }}>Trigger: {flow.triggerEventName}</span>
                </div>
                <p style={{ margin: 0, color: "#94a3b8" }}>
                  Optimizer {flow.useOptimizer ? "enabled" : "disabled"} • {flow.delayMinutes ? `${flow.delayMinutes} minute delay` : "no delay"}
                </p>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ padding: "0.15rem 0.6rem", borderRadius: "999px", background: flow.useOptimizer ? "rgba(56, 189, 248, 0.2)" : "rgba(148, 163, 184, 0.2)", color: flow.useOptimizer ? "#38bdf8" : "#94a3b8", fontSize: "0.8rem" }}>
                    Send-time optimizer
                  </span>
                  <span style={{ padding: "0.15rem 0.6rem", borderRadius: "999px", background: "rgba(148, 163, 184, 0.2)", color: "#94a3b8", fontSize: "0.8rem" }}>
                    Hygiene scoring (soon)
                  </span>
                  <span style={{ padding: "0.15rem 0.6rem", borderRadius: "999px", background: "rgba(148, 163, 184, 0.2)", color: "#94a3b8", fontSize: "0.8rem" }}>
                    Experiments (soon)
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => handleStatusChange(flow.id, flow.status === "ACTIVE" ? "PAUSED" : "ACTIVE")}
                    disabled={updating[flow.id]}
                    style={{
                      padding: "0.5rem 1.1rem",
                      borderRadius: "0.65rem",
                      border: "1px solid #1f2937",
                      background: "#111827",
                      color: "#f8fafc",
                      cursor: updating[flow.id] ? "default" : "pointer",
                      fontWeight: 600
                    }}
                  >
                    {updating[flow.id] ? "Updating..." : flow.status === "ACTIVE" ? "Pause" : "Activate"}
                  </button>
                  {flow.status !== "PAUSED" && pendingRuns.length > 0 && (
                    <span style={{ color: "#38bdf8" }}>{pendingRuns.length} run{pendingRuns.length === 1 ? "" : "s"} in progress</span>
                  )}
                </div>
              </header>

              <section>
                <h3 style={{ margin: "0 0 0.35rem", fontSize: "1.05rem" }}>Steps</h3>
                <ol style={{ margin: 0, paddingLeft: "1.25rem", color: "#e2e8f0" }}>
                  {stepItems.map((label, index) => (
                    <li key={`${flow.id}-step-${index}`} style={{ marginBottom: "0.3rem" }}>
                      {label}
                    </li>
                  ))}
                </ol>
              </section>

              <section>
                <h3 style={{ margin: "0 0 0.35rem", fontSize: "1.05rem" }}>Recent Runs</h3>
                <div style={{ border: "1px solid #1f2937", borderRadius: "0.75rem", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={TABLE_HEADER_STYLE}>Contact</th>
                        <th style={TABLE_HEADER_STYLE}>Status</th>
                        <th style={TABLE_HEADER_STYLE}>Scheduled</th>
                        <th style={TABLE_HEADER_STYLE}>Completed</th>
                        <th style={TABLE_HEADER_STYLE}>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flow.runs.length === 0 ? (
                        <tr>
                          <td style={{ ...TABLE_CELL_STYLE, textAlign: "center", color: "#64748b" }} colSpan={5}>
                            No runs yet.
                          </td>
                        </tr>
                      ) : (
                        flow.runs.slice(0, 10).map((run) => (
                          <tr key={run.id} style={{ color: "#e2e8f0" }}>
                            <td style={TABLE_CELL_STYLE}>
                              <div>{run.contact.email ?? "unknown"}</div>
                              <div style={{ color: "#64748b", fontSize: "0.8rem" }}>{run.contactId}</div>
                            </td>
                            <td style={{ ...TABLE_CELL_STYLE, color: runStatusColor(run.status) }}>
                              {run.status}
                              {run.cancelledReason && (
                                <div style={{ color: "#f87171", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                                  {run.cancelledReason}
                                </div>
                              )}
                            </td>
                            <td style={TABLE_CELL_STYLE}>{formatTimestamp(run.scheduledAt)}</td>
                            <td style={TABLE_CELL_STYLE}>{formatTimestamp(run.completedAt)}</td>
                            <td style={TABLE_CELL_STYLE}>
                              {run.message ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                                  <span>Status: {run.message.status}</span>
                                  {run.message.sentAt && <span>Sent: {formatTimestamp(run.message.sentAt)}</span>}
                                  {run.message.scheduledSendAt && (
                                    <span>Scheduled: {formatTimestamp(run.message.scheduledSendAt)}</span>
                                  )}
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </article>
          ))
        )}
      </section>
    </main>
  );
}

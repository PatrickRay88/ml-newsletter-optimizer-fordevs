"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceModeValue } from "@/lib/workspace";

export type BroadcastSummary = {
  id: string;
  name: string;
  status: string;
  sendMode: string;
  scheduledSendAt: string | null;
  createdAt: string;
  segment: string;
  template: string;
  audienceSize?: number;
  scheduledCount?: number;
  scheduledPreview?: Array<{
    scheduledAt: string;
    count: number;
    sampleEmails: string[];
  }>;
  total: number;
  delivered: number;
  bounced: number;
  suppressed: number;
  clicked: number;
  ctr: number;
  baselineCtr: number;
  upliftPct: number;
};

type TemplateOption = {
  id: string;
  name: string;
  subject: string;
};

type SegmentOption = {
  id: string;
  name: string;
  isSystem: boolean;
};

type Props = {
  templates: TemplateOption[];
  segments: SegmentOption[];
  broadcasts: BroadcastSummary[];
  defaultSendMode: WorkspaceModeValue;
  schedulerStatus: {
    state: "running" | "stale" | "idle";
    lastRunAt: string | null;
    nextDueScheduledAt: string | null;
    queuedScheduled: number;
    unresolvedOutcomes: number;
  };
};

type SendStrategy = "individual" | "bulk";

type Status = {
  type: "idle" | "loading" | "success" | "error";
  message?: string;
};

type TimelineItem = {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning";
};

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatUplift(value: number, hasBaseline: boolean): string {
  if (!hasBaseline) {
    return "N/A";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

function formatCount(value: number | undefined, fallback = 0): string {
  const resolved = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return resolved.toLocaleString();
}

function formatRelativeTime(value: string | null): string {
  if (!value) {
    return "Never";
  }

  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) {
    return "Unknown";
  }

  const diffMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildTimeline(broadcast: BroadcastSummary): TimelineItem[] {
  const items: TimelineItem[] = [];
  items.push({ label: "Created", value: formatDate(broadcast.createdAt) });

  if (broadcast.scheduledSendAt) {
    items.push({ label: "Scheduled", value: formatDate(broadcast.scheduledSendAt) });
  } else if (broadcast.status === "SENT" || broadcast.status === "SENDING") {
    items.push({ label: "Sent", value: "Processing" });
  }

  if (broadcast.delivered > 0) {
    items.push({
      label: "Delivered",
      value: broadcast.delivered.toLocaleString(),
      tone: "success"
    });
  }
  if (broadcast.bounced > 0) {
    items.push({
      label: "Bounced",
      value: broadcast.bounced.toLocaleString(),
      tone: "warning"
    });
  }
  if (broadcast.suppressed > 0) {
    items.push({
      label: "Suppressed",
      value: broadcast.suppressed.toLocaleString(),
      tone: "warning"
    });
  }

  if (items.length === 1) {
    items.push({ label: "Status", value: broadcast.status });
  }

  return items;
}

export default function BroadcastsClient({ templates, segments, broadcasts, defaultSendMode, schedulerStatus }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [segmentId, setSegmentId] = useState(segments.find((segment) => segment.isSystem)?.id ?? segments[0]?.id ?? "");
  const [sendMode, setSendMode] = useState<WorkspaceModeValue>(defaultSendMode);
  const [sendStrategy, setSendStrategy] = useState<SendStrategy>("bulk");

  const canCreate = useMemo(() => Boolean(name.trim()) && Boolean(templateId) && Boolean(segmentId), [name, templateId, segmentId]);

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const handleCreate = useCallback(async () => {
    if (!canCreate) {
      return;
    }
    setStatus({ type: "loading", message: "Creating broadcast..." });
    try {
      const response = await fetch("/api/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), templateId, segmentId, sendMode })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) {
        const message = typeof body.message === "string" ? body.message : "Unable to create broadcast";
        throw new Error(message);
      }
      setStatus({ type: "success", message: "Broadcast draft created" });
      setName("");
      refresh();
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Unable to create broadcast" });
    }
  }, [canCreate, name, refresh, segmentId, sendMode, templateId]);

  const handleSend = useCallback(
    async (broadcastId: string, useOptimizer: boolean) => {
      const confirmed = window.confirm(
        useOptimizer
          ? `Send this broadcast with ${sendStrategy} strategy at the recommended time?`
          : `Send this broadcast immediately with ${sendStrategy} strategy?`
      );
      if (!confirmed) {
        return;
      }
      setStatus({ type: "loading", message: useOptimizer ? "Scheduling with optimizer..." : "Sending now..." });
      try {
        const response = await fetch(`/api/broadcasts/${broadcastId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ useOptimizer, sendStrategy })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.success === false) {
          const message = typeof body.message === "string" ? body.message : "Unable to send broadcast";
          throw new Error(message);
        }
        setStatus({ type: "success", message: body.message ?? "Broadcast queued" });
        refresh();
      } catch (error) {
        setStatus({ type: "error", message: error instanceof Error ? error.message : "Unable to send broadcast" });
      }
    },
    [refresh, sendStrategy]
  );

  return (
    <main style={{ padding: "3rem", display: "grid", gap: "2rem" }}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <h1 style={{ margin: 0 }}>Broadcasts</h1>
        <p style={{ margin: 0, color: "#94a3b8", maxWidth: "46rem" }}>
          Schedule one-off sends to a segment. Use Send now for immediate delivery or Use optimizer delivery window
          to apply the optimizer window.
        </p>
        <div
          style={{
            marginTop: "0.5rem",
            border: "1px solid #1f2937",
            borderRadius: "0.75rem",
            background: "#0b1220",
            padding: "0.75rem 0.9rem",
            display: "grid",
            gap: "0.35rem"
          }}
        >
          <strong
            style={{
              color:
                schedulerStatus.state === "running"
                  ? "#86efac"
                  : schedulerStatus.state === "stale"
                    ? "#fbbf24"
                    : "#94a3b8"
            }}
          >
            Scheduler: {schedulerStatus.state === "running" ? "Active" : schedulerStatus.state === "stale" ? "Stale" : "Not started"}
          </strong>
          <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
            Last poll run: {formatRelativeTime(schedulerStatus.lastRunAt)}
          </span>
          <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
            Next due scheduled at: {formatDate(schedulerStatus.nextDueScheduledAt)}
          </span>
          <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
            Queued scheduled: {schedulerStatus.queuedScheduled.toLocaleString()} • Pending outcomes: {schedulerStatus.unresolvedOutcomes.toLocaleString()}
          </span>
          {schedulerStatus.state !== "running" && (
            <span style={{ color: "#fbbf24", fontSize: "0.85rem" }}>
              Run `npm run dev:scheduler` locally or schedule `/api/jobs/poll-email-status` every 2-5 minutes.
            </span>
          )}
        </div>
      </header>

      <section
        style={{
          border: "1px solid #1f2937",
          borderRadius: "1rem",
          padding: "1.5rem",
          background: "rgba(15, 23, 42, 0.85)",
          display: "grid",
          gap: "1rem"
        }}
      >
        <h2 style={{ margin: 0 }}>Create broadcast</h2>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="January onboarding update"
              data-walkthrough="broadcast-name"
              style={{
                padding: "0.65rem 0.75rem",
                borderRadius: "0.6rem",
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#e2e8f0"
              }}
            />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Segment</span>
            <select
              value={segmentId}
              onChange={(event) => setSegmentId(event.target.value)}
              style={{
                padding: "0.65rem 0.75rem",
                borderRadius: "0.6rem",
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#e2e8f0"
              }}
            >
              {segments.map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {segment.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Template</span>
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              style={{
                padding: "0.65rem 0.75rem",
                borderRadius: "0.6rem",
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#e2e8f0"
              }}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Send mode</span>
            <select
              value={sendMode}
              onChange={(event) => setSendMode(event.target.value as WorkspaceModeValue)}
              style={{
                padding: "0.65rem 0.75rem",
                borderRadius: "0.6rem",
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#e2e8f0"
              }}
            >
              <option value="TEST">Sandbox</option>
              <option value="PRODUCTION">Live</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Delivery strategy</span>
            <select
              value={sendStrategy}
              onChange={(event) => setSendStrategy(event.target.value as SendStrategy)}
              style={{
                padding: "0.65rem 0.75rem",
                borderRadius: "0.6rem",
                border: "1px solid #334155",
                background: "#0f172a",
                color: "#e2e8f0"
              }}
            >
              <option value="bulk">Bulk batches</option>
              <option value="individual">Individual throttled</option>
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate || pending}
            data-walkthrough="broadcast-create"
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "0.75rem",
              border: "none",
              background: canCreate ? "linear-gradient(135deg, #38bdf8, #6366f1)" : "#1e293b",
              color: "#0f172a",
              fontWeight: 600,
              cursor: canCreate ? "pointer" : "not-allowed"
            }}
          >
            {pending ? "Working..." : "Create draft"}
          </button>
          {status.type !== "idle" && (
            <span style={{ color: status.type === "error" ? "#fca5a5" : "#86efac" }}>{status.message}</span>
          )}
        </div>
      </section>

      <section style={{ display: "grid", gap: "1rem" }}>
        {broadcasts.map((broadcast) => {
          const isFinal = ["SENT", "SCHEDULED"].includes(broadcast.status);
          const timeline = buildTimeline(broadcast);
          return (
            <article
              key={broadcast.id}
              style={{
                border: "1px solid #1f2937",
                borderRadius: "1rem",
                padding: "1.5rem",
                background: "rgba(15, 23, 42, 0.85)",
                display: "grid",
                gap: "1rem"
              }}
            >
              <header style={{ display: "flex", justifyContent: "space-between", gap: "1.5rem", flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0 }}>{broadcast.name}</h2>
                  <p style={{ margin: "0.35rem 0 0", color: "#94a3b8" }}>
                    {broadcast.segment} • {broadcast.template} • {broadcast.sendMode}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>{broadcast.status}</p>
                  <p style={{ margin: "0.35rem 0 0", color: "#64748b" }}>
                    Scheduled: {formatDate(broadcast.scheduledSendAt)}
                  </p>
                </div>
              </header>

              <dl
                style={{
                  margin: 0,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "0.75rem"
                }}
              >
                <Metric label="Audience" value={formatCount(broadcast.audienceSize, broadcast.total)} />
                <Metric label="Processed" value={formatCount(broadcast.total)} />
                <Metric label="Delivered" value={formatCount(broadcast.delivered)} />
                <Metric label="Bounced" value={formatCount(broadcast.bounced)} />
                <Metric label="Suppressed" value={formatCount(broadcast.suppressed)} />
                <Metric label="Clicks" value={formatCount(broadcast.clicked)} />
                <Metric label="CTR" value={formatPercent(broadcast.ctr)} />
                <Metric label="Baseline CTR" value={formatPercent(broadcast.baselineCtr)} />
                <Metric label="Uplift" value={formatUplift(broadcast.upliftPct, broadcast.baselineCtr > 0)} />
              </dl>

              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => handleSend(broadcast.id, false)}
                  disabled={isFinal || pending}
                  style={{
                    padding: "0.65rem 1.25rem",
                    borderRadius: "0.6rem",
                    border: "1px solid #38bdf8",
                    background: "transparent",
                    color: "#38bdf8",
                    fontWeight: 600,
                    cursor: isFinal ? "not-allowed" : "pointer"
                  }}
                >
                  Send now
                </button>
                <button
                  type="button"
                  onClick={() => handleSend(broadcast.id, true)}
                  disabled={isFinal || pending}
                  data-walkthrough="broadcast-send-optimizer"
                  style={{
                    padding: "0.65rem 1.25rem",
                    borderRadius: "0.6rem",
                    border: "none",
                    background: "linear-gradient(135deg, #34d399, #22c55e)",
                    color: "#022c22",
                    fontWeight: 600,
                    cursor: isFinal ? "not-allowed" : "pointer"
                  }}
                >
                  Use optimizer delivery window
                </button>
              </div>

              {(broadcast.scheduledPreview?.length ?? 0) > 0 && (
                <div
                  style={{
                    borderTop: "1px solid #1f2937",
                    paddingTop: "0.75rem",
                    display: "grid",
                    gap: "0.5rem"
                  }}
                >
                  <strong>Scheduled Delivery Preview</strong>
                  <p style={{ margin: 0, color: "#94a3b8" }}>
                    {formatCount(broadcast.scheduledCount)} messages are queued across upcoming optimizer windows.
                  </p>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
                    {(broadcast.scheduledPreview ?? []).map((window) => (
                      <li
                        key={`${broadcast.id}-${window.scheduledAt}`}
                        style={{
                          display: "grid",
                          gap: "0.2rem",
                          border: "1px solid #1f2937",
                          borderRadius: "0.5rem",
                          padding: "0.55rem 0.65rem",
                          background: "#0b1220"
                        }}
                      >
                        <span style={{ color: "#cbd5f5", fontWeight: 600 }}>
                          {formatDate(window.scheduledAt)} • {window.count.toLocaleString()} recipients
                        </span>
                        <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
                          Sample: {window.sampleEmails.slice(0, 3).join(", ") || "No sample emails"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p style={{ margin: 0, color: "#fbbf24", fontSize: "0.85rem" }}>
                    Queued sends auto-dispatch when the poll scheduler runs.
                  </p>
                </div>
              )}

              <div
                style={{
                  borderTop: "1px solid #1f2937",
                  paddingTop: "0.75rem",
                  display: "grid",
                  gap: "0.5rem"
                }}
              >
                <strong>Timeline</strong>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.35rem" }}>
                  {timeline.map((item) => (
                    <li
                      key={item.label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        color:
                          item.tone === "success"
                            ? "#86efac"
                            : item.tone === "warning"
                              ? "#fca5a5"
                              : "#cbd5f5"
                      }}
                    >
                      <span>{item.label}</span>
                      <span>{item.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}

        {broadcasts.length === 0 && (
          <p style={{ color: "#94a3b8" }}>No broadcasts yet. Create a draft to get started.</p>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>{label}</span>
      <strong style={{ fontSize: "1.1rem" }}>{value}</strong>
    </div>
  );
}

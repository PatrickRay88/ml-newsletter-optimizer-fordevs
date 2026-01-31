"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContactStatus, Segment } from "@prisma/client";
import type { SegmentHeatmap } from "@/lib/segments";

const CARD_STYLE: React.CSSProperties = {
  borderRadius: "1rem",
  border: "1px solid #1e293b",
  padding: "1.5rem",
  background: "rgba(15, 23, 42, 0.85)",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem"
};

type SegmentsClientProps = {
  segments: Segment[];
  statusOptions: ContactStatus[];
  distinct: {
    timezones: string[];
    tags: string[];
  };
  heatmaps: Record<string, SegmentHeatmap>;
};

type ActionStatus = {
  type: "idle" | "success" | "error";
  message?: string;
};

type BuilderState = {
  name: string;
  description: string;
  status: string;
  tag: string;
  timezone: string;
  lastEventDays: string;
};

const INITIAL_STATE: BuilderState = {
  name: "",
  description: "",
  status: "",
  tag: "",
  timezone: "",
  lastEventDays: ""
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeHour(hour: number): string {
  const dayIndex = Math.floor(hour / 24) % 7;
  const hourOfDay = hour % 24;
  return `${DAY_LABELS[dayIndex]} ${hourOfDay.toString().padStart(2, "0")}:00`;
}

export default function SegmentsClient({ segments, statusOptions, distinct, heatmaps }: SegmentsClientProps) {
  const router = useRouter();
  const [builder, setBuilder] = useState<BuilderState>(INITIAL_STATE);
  const [status, setStatus] = useState<ActionStatus>({ type: "idle" });
  const [recomputeStatus, setRecomputeStatus] = useState<ActionStatus>({ type: "idle" });

  const filtersPayload = useMemo(() => {
    const filters: Array<{ type: string; value: string | number }> = [];
    if (builder.status) {
      filters.push({ type: "status", value: builder.status });
    }
    if (builder.tag) {
      filters.push({ type: "tag", value: builder.tag });
    }
    if (builder.timezone) {
      filters.push({ type: "timezone", value: builder.timezone });
    }
    if (builder.lastEventDays) {
      const parsed = Number(builder.lastEventDays);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        filters.push({ type: "last_event_within_days", value: parsed });
      }
    }
    return filters;
  }, [builder]);

  const handleCreate = useCallback(async () => {
    if (!builder.name.trim()) {
      setStatus({ type: "error", message: "Segment name is required" });
      return;
    }

    try {
      const response = await fetch("/api/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: builder.name,
          description: builder.description || undefined,
          filters: filtersPayload
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof body.message === "string" ? body.message : "Failed to create segment";
        throw new Error(message);
      }

      setStatus({ type: "success", message: "Segment created" });
      setBuilder(INITIAL_STATE);
      await fetch(`/api/segments/${body.segment.id}/recompute`, { method: "POST" });
      router.refresh();
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to create segment"
      });
    }
  }, [builder, filtersPayload, router]);

  const triggerRecompute = useCallback(
    async (segmentId: string) => {
      try {
        const response = await fetch(`/api/segments/${segmentId}/recompute`, { method: "POST" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = typeof body.message === "string" ? body.message : "Recompute failed";
          throw new Error(message);
        }
        setRecomputeStatus({ type: "success", message: `Recomputed ${body.result?.total ?? 0} members` });
        router.refresh();
      } catch (error) {
        setRecomputeStatus({
          type: "error",
          message: error instanceof Error ? error.message : "Recompute failed"
        });
      }
    },
    [router]
  );

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "2rem", padding: "2rem" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Segments</h1>
        <p style={{ margin: 0, color: "#94a3b8" }}>
          Build rule-based segments using contact attributes and recompute membership as needed.
        </p>
      </header>

      <section style={{ ...CARD_STYLE, gap: "1rem" }}>
        <h2 style={{ margin: 0 }}>Create segment</h2>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>Name</span>
            <input
              value={builder.name}
              onChange={(event) => setBuilder((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Active East Coast"
              style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>Description</span>
            <input
              value={builder.description}
              onChange={(event) => setBuilder((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Active contacts with recent activity"
              style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>Status</span>
            <select
              value={builder.status}
              onChange={(event) => setBuilder((prev) => ({ ...prev, status: event.target.value }))}
              style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
            >
              <option value="">Any status</option>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>Tag</span>
            <select
              value={builder.tag}
              onChange={(event) => setBuilder((prev) => ({ ...prev, tag: event.target.value }))}
              style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
            >
              <option value="">Any tag</option>
              {distinct.tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>Timezone</span>
            <select
              value={builder.timezone}
              onChange={(event) => setBuilder((prev) => ({ ...prev, timezone: event.target.value }))}
              style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
            >
              <option value="">Any timezone</option>
              {distinct.timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>Last event (days)</span>
            <input
              value={builder.lastEventDays}
              onChange={(event) => setBuilder((prev) => ({ ...prev, lastEventDays: event.target.value }))}
              placeholder="7"
              style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <button
            type="button"
            onClick={handleCreate}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#38bdf8",
              color: "#0f172a",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Create segment
          </button>
          {status.type !== "idle" && (
            <span
              style={{
                color: status.type === "success" ? "#bbf7d0" : "#fecaca",
                fontWeight: 500
              }}
            >
              {status.message}
            </span>
          )}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2 style={{ margin: 0 }}>Existing segments</h2>
        <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {segments.map((segment) => (
            <article key={segment.id} style={CARD_STYLE}>
              <header>
                <h3 style={{ margin: 0 }}>{segment.name}</h3>
                <p style={{ margin: "0.25rem 0", color: "#94a3b8" }}>{segment.description ?? "No description"}</p>
              </header>
              <SegmentHeatmapView heatmap={heatmaps[segment.id]} />
              <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.35rem 0.65rem", margin: 0 }}>
                <dt>Last computed</dt>
                <dd>{segment.lastComputedAt ? new Date(segment.lastComputedAt).toLocaleString() : "Never"}</dd>
                <dt>Estimated size</dt>
                <dd>{segment.estimatedSize ?? 0}</dd>
                <dt>Created</dt>
                <dd>{new Date(segment.createdAt).toLocaleDateString()}</dd>
              </dl>
              <button
                type="button"
                onClick={() => triggerRecompute(segment.id)}
                style={{
                  marginTop: "0.5rem",
                  padding: "0.6rem 1.25rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #34d399",
                  background: "transparent",
                  color: "#34d399",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Recompute members
              </button>
            </article>
          ))}
        </div>
        {recomputeStatus.type !== "idle" && (
          <span
            style={{
              color: recomputeStatus.type === "success" ? "#bbf7d0" : "#fecaca",
              fontWeight: 500
            }}
          >
            {recomputeStatus.message}
          </span>
        )}
      </section>
    </section>
  );
}

function SegmentHeatmapView({ heatmap }: { heatmap?: SegmentHeatmap }) {
  if (!heatmap) {
    return <p style={{ color: "#94a3b8", margin: 0 }}>No activity yet.</p>;
  }

  const totals = heatmap.cells.reduce(
    (acc, cell) => ({
      sends: acc.sends + cell.sends,
      clicks: acc.clicks + cell.clicks
    }),
    { sends: 0, clicks: 0 }
  );
  const overallCtr = totals.sends > 0 ? (totals.clicks / totals.sends) * 100 : 0;
  const maxRate = Math.max(0, ...heatmap.cells.map((cell) => cell.rate));
  const maxSends = Math.max(0, ...heatmap.cells.map((cell) => cell.sends));
  const bestWindow = heatmap.bestHour !== null ? describeHour(heatmap.bestHour) : "No clicks yet";
  const bestRateLabel = heatmap.bestHour !== null ? `${(heatmap.bestRate * 100).toFixed(1)}%` : "—";

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
        <span>Best window: {bestWindow}</span>
        <span>CTR: {bestRateLabel} (overall {overallCtr.toFixed(1)}%)</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(24, minmax(18px, 1fr))",
            gap: "4px",
            minWidth: "520px"
          }}
        >
          {heatmap.cells.map((cell) => {
            const intensity = maxRate > 0
              ? cell.rate / maxRate
              : maxSends > 0
                ? cell.sends / maxSends
                : 0;
            const alpha = 0.12 + intensity * 0.68;
            return (
              <div
                key={cell.hour}
                title={`${describeHour(cell.hour)} | sends: ${cell.sends} | clicks: ${cell.clicks} | CTR ${(cell.rate * 100).toFixed(1)}%`}
                style={{
                  height: "16px",
                  borderRadius: "4px",
                  background: cell.sends === 0 ? "rgba(30, 41, 59, 0.4)" : `rgba(56, 189, 248, ${alpha})`,
                  border: "1px solid rgba(56, 189, 248, 0.15)"
                }}
              />
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "0.8rem" }}>
        <span>Sun → Sat (rows) • 00:00 → 23:00 (columns)</span>
        <span>Higher intensity = higher CTR</span>
      </div>
      <div
        style={{
          borderTop: "1px solid #1f2937",
          paddingTop: "0.5rem",
          color: "#94a3b8",
          fontSize: "0.85rem"
        }}
      >
        Recommended next action: {heatmap.bestHour !== null ? "Schedule next broadcast in the best window." : "Collect more engagement data."}
      </div>
    </div>
  );
}

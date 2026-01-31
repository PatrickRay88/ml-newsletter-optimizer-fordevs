"use client";

import { useCallback, useState } from "react";

type Props = {
  delivered: number;
  bounced: number;
  failed: number;
  complained: number;
  suppressed: number;
  outcomesTotal: number;
  suppressionCount: number;
  statusMap: Record<string, number>;
  topDomains: Array<[string, number]>;
};

type ActionStatus = {
  type: "idle" | "loading" | "success" | "error";
  message?: string;
};

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function DeliverabilityClient({
  delivered,
  bounced,
  failed,
  complained,
  suppressed,
  outcomesTotal,
  suppressionCount,
  statusMap,
  topDomains
}: Props) {
  const [status, setStatus] = useState<Record<string, ActionStatus>>({});

  const runAction = useCallback(async (key: string, endpoint: string, payload?: unknown) => {
    setStatus((prev) => ({ ...prev, [key]: { type: "loading" } }));
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) {
        const message = typeof body.message === "string" ? body.message : "Action failed";
        throw new Error(message);
      }
      setStatus((prev) => ({ ...prev, [key]: { type: "success", message: body.message ?? "Action completed" } }));
    } catch (error) {
      setStatus((prev) => ({
        ...prev,
        [key]: { type: "error", message: error instanceof Error ? error.message : "Action failed" }
      }));
    }
  }, []);

  const bounceRate = outcomesTotal ? bounced / outcomesTotal : 0;
  const suppressionRate = outcomesTotal ? suppressed / outcomesTotal : 0;

  return (
    <main style={{ padding: "3rem", display: "grid", gap: "2rem" }}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <h1 style={{ margin: 0 }}>Deliverability</h1>
        <p style={{ margin: 0, color: "#94a3b8", maxWidth: "46rem" }}>
          Monitor bounce health, suppression volume, and domain mix. Use the action list to run remediation steps.
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))"
        }}
      >
        <MetricCard label="Delivered" value={delivered.toLocaleString()} />
        <MetricCard label="Bounced" value={bounced.toLocaleString()} />
        <MetricCard label="Failed" value={failed.toLocaleString()} />
        <MetricCard label="Complained" value={complained.toLocaleString()} />
        <MetricCard label="Suppressed" value={suppressed.toLocaleString()} />
        <MetricCard label="Bounce rate" value={formatPercent(bounceRate)} accent />
        <MetricCard label="Suppression rate" value={formatPercent(suppressionRate)} accent />
        <MetricCard label="Suppression records" value={suppressionCount.toLocaleString()} />
      </section>

      <section style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <article style={{ border: "1px solid #1f2937", borderRadius: "1rem", padding: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>Contact health</h2>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#94a3b8" }}>
            <li>Active: {(statusMap.ACTIVE ?? 0).toLocaleString()}</li>
            <li>Suppressed: {(statusMap.SUPPRESSED ?? 0).toLocaleString()}</li>
            <li>Bounced: {(statusMap.BOUNCED ?? 0).toLocaleString()}</li>
            <li>Complained: {(statusMap.COMPLAINED ?? 0).toLocaleString()}</li>
          </ul>
        </article>

        <article style={{ border: "1px solid #1f2937", borderRadius: "1rem", padding: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>Top domains</h2>
          {topDomains.length === 0 ? (
            <p style={{ color: "#94a3b8" }}>No contacts yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#94a3b8" }}>
              {topDomains.map(([domain, count]) => (
                <li key={domain}>
                  {domain} — {count.toLocaleString()} contacts
                </li>
              ))}
            </ul>
          )}
        </article>

        <article style={{ border: "1px solid #1f2937", borderRadius: "1rem", padding: "1.5rem", display: "grid", gap: "0.75rem" }}>
          <h2 style={{ marginTop: 0 }}>Action list</h2>
          <button
            type="button"
            onClick={() => runAction("hygiene", "/api/jobs/hygiene-scan", { suppressHighRisk: true })}
            style={{
              padding: "0.65rem 1.25rem",
              borderRadius: "0.75rem",
              border: "1px solid #34d399",
              background: "transparent",
              color: "#34d399",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Suppress risky contacts
          </button>
          <button
            type="button"
            onClick={() => runAction("poll", "/api/jobs/poll-email-status")}
            style={{
              padding: "0.65rem 1.25rem",
              borderRadius: "0.75rem",
              border: "1px solid #38bdf8",
              background: "transparent",
              color: "#38bdf8",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Refresh delivery outcomes
          </button>
          <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
            Throttle cold segments and remove repeated hard bounces from lists after review.
          </div>
          {Object.values(status).some((entry) => entry.type !== "idle") && (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {Object.entries(status).map(([key, entry]) =>
                entry.type === "idle" ? null : (
                  <div
                    key={key}
                    style={{
                      padding: "0.6rem 0.85rem",
                      borderRadius: "0.65rem",
                      background: entry.type === "error" ? "rgba(248, 113, 113, 0.15)" : "rgba(34, 197, 94, 0.15)",
                      border: entry.type === "error" ? "1px solid rgba(248, 113, 113, 0.35)" : "1px solid rgba(34, 197, 94, 0.35)",
                      color: entry.type === "error" ? "#fecaca" : "#bbf7d0"
                    }}
                  >
                    {entry.message}
                  </div>
                )
              )}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
  accent?: boolean;
};

function MetricCard({ label, value, accent }: MetricCardProps) {
  return (
    <div
      style={{
        borderRadius: "1rem",
        padding: "1.25rem",
        background: accent ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.85)",
        border: accent ? "1px solid rgba(56, 189, 248, 0.35)" : "1px solid #1f2937",
        display: "grid",
        gap: "0.35rem"
      }}
    >
      <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>{label}</span>
      <strong style={{ fontSize: "1.4rem" }}>{value}</strong>
    </div>
  );
}

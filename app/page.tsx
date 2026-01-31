import { loadDashboardMetrics } from "@/lib/dashboard";

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatUplift(value: number): string {
  const sign = value >= 0 ? "▲" : "▼";
  return `${sign} ${Math.abs(value).toFixed(2)}%`;
}

function formatDateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function HomePage() {
  const summary = await loadDashboardMetrics();

  return (
    <main style={{ padding: "3rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
      <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "2rem" }}>Deliverability Dashboard</h1>
        <p style={{ margin: 0, color: "#94a3b8" }}>
          Synthetic metrics derived from recent broadcasts. Actual CTR is compared against the baseline schedule
          to show uplift from the send-time optimizer.
        </p>
      </section>

      <section style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <StatusCard label="Workspace mode" value={summary.autopilot.mode} />
        <StatusCard label="Test Mode" value={summary.autopilot.testModeEnabled ? "Enabled" : "Disabled"} />
        <StatusCard
          label="Send-time optimizer"
          value={summary.autopilot.optimizerActive ? "Active" : "Idle"}
          meta={
            summary.autopilot.lastOptimizerDecisionAt
              ? `Last decision ${new Date(summary.autopilot.lastOptimizerDecisionAt).toLocaleString()}`
              : "No decisions yet"
          }
        />
        <StatusCard
          label="Hygiene scoring"
          value={summary.autopilot.hygieneActive ? "Active" : "Idle"}
          meta={
            summary.autopilot.lastHygieneRunAt
              ? `Last run ${new Date(summary.autopilot.lastHygieneRunAt).toLocaleString()}`
              : "No sweeps yet"
          }
        />
      </section>

      <section
        style={{
          display: "grid",
          gap: "1.25rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))"
        }}
      >
        <MetricCard label="Total sends" value={summary.totals.total.toLocaleString()} />
        <MetricCard label="Delivered" value={summary.totals.delivered.toLocaleString()} />
        <MetricCard label="Bounced" value={summary.totals.bounced.toLocaleString()} />
        <MetricCard label="Suppressed" value={summary.totals.suppressed.toLocaleString()} />
        <MetricCard label="Clicks" value={summary.totals.clicks.toLocaleString()} />
        <MetricCard label="CTR (actual)" value={formatPercent(summary.totals.actualCtr)} />
        <MetricCard label="CTR (baseline)" value={formatPercent(summary.totals.baselineCtr)} />
        <MetricCard label="CTR uplift" value={formatUplift(summary.totals.upliftPct)} accent />
      </section>
      <p style={{ margin: 0, color: "#64748b" }}>
        Baseline CTR reflects a fixed schedule. Uplift is computed as {"$\\frac{\\text{actual}-\\text{baseline}}{\\text{baseline}}$"}.
      </p>

      <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2 style={{ margin: 0 }}>Last 7 days</h2>
        <div
          style={{
            border: "1px solid #1e293b",
            borderRadius: "1rem",
            padding: "1.5rem",
            background: "rgba(15, 23, 42, 0.85)",
            display: "grid",
            gap: "1rem"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
            <span>Sends</span>
            <span>Clicks</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "0.75rem" }}>
            {summary.daily.map((day) => {
              const maxSends = Math.max(1, ...summary.daily.map((entry) => entry.sends));
              const sendHeight = Math.round((day.sends / maxSends) * 120);
              const clickHeight = Math.round((day.clicks / maxSends) * 120);
              return (
                <div key={day.date} style={{ display: "grid", gap: "0.5rem", alignItems: "end" }}>
                  <div style={{ height: 130, display: "flex", gap: "0.35rem", alignItems: "flex-end" }}>
                    <div
                      style={{
                        width: "100%",
                        height: sendHeight,
                        background: "rgba(56, 189, 248, 0.35)",
                        borderRadius: "0.5rem",
                        border: "1px solid rgba(56, 189, 248, 0.6)"
                      }}
                    />
                    <div
                      style={{
                        width: "60%",
                        height: clickHeight,
                        background: "rgba(16, 185, 129, 0.35)",
                        borderRadius: "0.5rem",
                        border: "1px solid rgba(16, 185, 129, 0.6)"
                      }}
                    />
                  </div>
                  <div style={{ textAlign: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
                    {formatDateLabel(day.date)}
                  </div>
                </div>
              );
            })}
          </div>
          {summary.daily.every((entry) => entry.sends === 0) && (
            <p style={{ margin: 0, color: "#94a3b8" }}>No recent sends yet. Send a test broadcast to populate the chart.</p>
          )}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2 style={{ margin: 0 }}>Broadcast performance</h2>
        <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {summary.broadcasts.map((broadcast) => (
            <article
              key={broadcast.id}
              style={{
                border: "1px solid #1e293b",
                borderRadius: "1rem",
                padding: "1.5rem",
                background: "rgba(15, 23, 42, 0.85)",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem"
              }}
            >
              <header>
                <h3 style={{ margin: 0, fontSize: "1.25rem" }}>{broadcast.name}</h3>
                <p style={{ margin: "0.25rem 0", color: "#94a3b8" }}>
                  Sent {new Date(broadcast.createdAt).toLocaleString()}
                </p>
              </header>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.35rem 0.65rem" }}>
                <dt>Sends</dt>
                <dd>{broadcast.total.toLocaleString()}</dd>
                <dt>Delivered</dt>
                <dd>{broadcast.delivered.toLocaleString()}</dd>
                <dt>Bounced</dt>
                <dd>{broadcast.bounced.toLocaleString()}</dd>
                <dt>Clicks</dt>
                <dd>{broadcast.clicks.toLocaleString()}</dd>
                <dt>CTR (actual)</dt>
                <dd>{formatPercent(broadcast.actualCtr)}</dd>
                <dt>CTR (baseline)</dt>
                <dd>{formatPercent(broadcast.baselineCtr)}</dd>
                <dt>Uplift</dt>
                <dd>{formatUplift(broadcast.upliftPct)}</dd>
              </dl>
            </article>
          ))}
          {summary.broadcasts.length === 0 && (
            <p style={{ color: "#94a3b8" }}>No broadcasts yet. Send a test broadcast to populate metrics.</p>
          )}
        </div>
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
        border: accent ? "1px solid rgba(56, 189, 248, 0.35)" : "1px solid #1e293b",
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem"
      }}
    >
      <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>{label}</span>
      <strong style={{ fontSize: "1.5rem" }}>{value}</strong>
    </div>
  );
}

type StatusCardProps = {
  label: string;
  value: string;
  meta?: string;
};

function StatusCard({ label, value, meta }: StatusCardProps) {
  return (
    <div
      style={{
        borderRadius: "1rem",
        padding: "1.25rem",
        background: "rgba(15, 23, 42, 0.85)",
        border: "1px solid #1e293b",
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem"
      }}
    >
      <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>{label}</span>
      <strong style={{ fontSize: "1.3rem" }}>{value}</strong>
      {meta && <span style={{ color: "#64748b", fontSize: "0.85rem" }}>{meta}</span>}
    </div>
  );
}

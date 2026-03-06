import Link from "next/link";
import { loadDashboardMetrics } from "@/lib/dashboard";

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

export default async function ProductDashboardPage() {
  const summary = await loadDashboardMetrics();

  return (
    <main style={{ padding: "2.5rem", display: "grid", gap: "1.25rem" }}>
      <header style={{ display: "grid", gap: "0.35rem" }}>
        <h1 style={{ margin: 0 }}>Workspace Dashboard</h1>
        <p style={{ margin: 0, color: "#94a3b8" }}>
          Sandbox metrics are isolated from Live and safe for integration rehearsals.
        </p>
      </header>

      <section style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="marketing-card"><h2>Total sends</h2><p>{summary.totals.total.toLocaleString()}</p></div>
        <div className="marketing-card"><h2>Delivered</h2><p>{summary.totals.delivered.toLocaleString()}</p></div>
        <div className="marketing-card"><h2>Bounced</h2><p>{summary.totals.bounced.toLocaleString()}</p></div>
        <div className="marketing-card"><h2>Actual CTR</h2><p>{formatPercent(summary.totals.actualCtr)}</p></div>
        <div className="marketing-card"><h2>Baseline CTR</h2><p>{formatPercent(summary.totals.baselineCtr)}</p></div>
        <div className="marketing-card"><h2>CTR Uplift</h2><p>{formatUplift(summary.totals.upliftPct, summary.totals.baselineCtr > 0)}</p></div>
      </section>

      {summary.totals.baselineCtr === 0 && summary.totals.total > 0 && (
        <p style={{ margin: 0, color: "#94a3b8" }}>
          Baseline CTR appears after synthetic outcomes include baseline probabilities.
        </p>
      )}

      <section className="marketing-band" style={{ marginTop: "0.5rem" }}>
        <h2>Next actions</h2>
        <p>Complete onboarding in Sandbox, validate outcomes, then use Billing to unlock Live.</p>
        <div className="marketing-actions">
          <Link href="/app/onboarding" className="marketing-button marketing-button-primary">Open onboarding</Link>
          <Link href="/app/integrations" className="marketing-button marketing-button-secondary">Connect engine</Link>
        </div>
      </section>
    </main>
  );
}

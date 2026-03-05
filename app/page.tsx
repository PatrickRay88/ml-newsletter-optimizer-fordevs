import Link from "next/link";
import MarketingShell from "@/app/components/marketing-shell";

const FEATURES = [
  {
    title: "Send-time optimization",
    detail: "Dispatch emails in high-probability windows based on contact and segment behavior."
  },
  {
    title: "Hygiene suppression",
    detail: "Automatically identify risky contacts before they hurt reputation and deliverability."
  },
  {
    title: "Experimentation loop",
    detail: "Measure baseline vs optimized outcomes and iterate with clear decision telemetry."
  }
];

export default function MarketingHomePage() {
  return (
    <MarketingShell>
      <main className="marketing-main">
        <section className="marketing-hero">
          <p className="marketing-eyebrow">DispatchIQ for developer teams</p>
          <h1>Optimization that snaps onto your email engine.</h1>
          <p>
            Connect your provider, validate workflows in Sandbox, then move to Live with confidence and measurable uplift.
          </p>
          <div className="marketing-actions">
            <Link href="/app" className="marketing-button marketing-button-primary">Start free</Link>
            <Link href="/docs" className="marketing-button marketing-button-secondary">View docs</Link>
          </div>
        </section>

        <section className="marketing-diagram">
          <div>Engine</div>
          <span aria-hidden>{"->"}</span>
          <div>DispatchIQ</div>
          <span aria-hidden>{"->"}</span>
          <div>Better outcomes</div>
        </section>

        <section className="marketing-grid">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="marketing-card">
              <h2>{feature.title}</h2>
              <p>{feature.detail}</p>
            </article>
          ))}
        </section>

        <section className="marketing-band">
          <h2>Integrations</h2>
          <p>Resend is first-class today. Postmark, Mailgun, SendGrid, and SES are planned through adapter support.</p>
        </section>
      </main>
    </MarketingShell>
  );
}

import MarketingShell from "@/app/components/marketing-shell";

export default function SecurityPage() {
  return (
    <MarketingShell>
      <main className="marketing-main marketing-page">
        <h1>Security</h1>
        <div className="marketing-grid">
          <article className="marketing-card">
            <h2>Storage</h2>
            <p>Credentials are encrypted at rest and scoped by workspace + environment.</p>
          </article>
          <article className="marketing-card">
            <h2>Webhook integrity</h2>
            <p>Provider webhook signature verification is supported to prevent forged outcome events.</p>
          </article>
          <article className="marketing-card">
            <h2>Data boundaries</h2>
            <p>Sandbox and Live are isolated to prevent accidental crossover during integration testing.</p>
          </article>
        </div>
      </main>
    </MarketingShell>
  );
}

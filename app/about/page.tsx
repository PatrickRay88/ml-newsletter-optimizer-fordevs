import MarketingShell from "@/app/components/marketing-shell";

export default function AboutPage() {
  return (
    <MarketingShell>
      <main className="marketing-main marketing-page">
        <h1>About DispatchIQ</h1>
        <p>
          DispatchIQ helps product teams improve email outcomes without replacing their provider stack.
          We focus on measurable automation, explainability, and developer-first integration.
        </p>
        <section className="marketing-band">
          <h2>Built for practical operators</h2>
          <p>API-first controls, clear telemetry, and a safe Sandbox path before every Live rollout.</p>
        </section>
      </main>
    </MarketingShell>
  );
}

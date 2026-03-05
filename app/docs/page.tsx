import MarketingShell from "@/app/components/marketing-shell";

export default function DocsPage() {
  return (
    <MarketingShell>
      <main className="marketing-main marketing-page">
        <h1>Docs</h1>
        <div className="marketing-grid">
          <article className="marketing-card">
            <h2>Quickstart</h2>
            <p>1. Create workspace. 2. Connect engine. 3. Send sandbox test. 4. Validate outcomes.</p>
          </article>
          <article className="marketing-card">
            <h2>API surface</h2>
            <p>/events, /contacts/upsert, /segments, /broadcasts, /flows, webhooks.</p>
          </article>
          <article className="marketing-card">
            <h2>SDK examples</h2>
            <p>Node and Next.js snippets are being expanded as part of v2 onboarding docs.</p>
          </article>
        </div>
      </main>
    </MarketingShell>
  );
}

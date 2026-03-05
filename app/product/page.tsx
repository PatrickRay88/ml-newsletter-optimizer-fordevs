import MarketingShell from "@/app/components/marketing-shell";

export default function ProductPage() {
  return (
    <MarketingShell>
      <main className="marketing-main marketing-page">
        <h1>Product</h1>
        <p>
          DispatchIQ runs between your engine and outcomes: events feed segmentation, segmentation drives schedules,
          and outcomes close the learning loop.
        </p>
        <div className="marketing-grid">
          <article className="marketing-card">
            <h2>Sandbox vs Live</h2>
            <p>Sandbox is for integration rehearsal and safe sending constraints; Live is for production recipients.</p>
          </article>
          <article className="marketing-card">
            <h2>What we are not</h2>
            <p>DispatchIQ is not an ESP and not a full marketing suite. It is the optimization layer on top.</p>
          </article>
          <article className="marketing-card">
            <h2>Operator clarity</h2>
            <p>Every recommendation is logged with rationale so teams can trust and audit automation.</p>
          </article>
        </div>
      </main>
    </MarketingShell>
  );
}

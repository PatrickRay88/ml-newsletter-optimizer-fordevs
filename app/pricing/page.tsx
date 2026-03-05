import Link from "next/link";
import MarketingShell from "@/app/components/marketing-shell";

const TIERS = [
  { name: "Free", price: "$0", detail: "Sandbox only, low limits, integration rehearsal." },
  { name: "Starter", price: "$9/mo", detail: "Live enabled, send-time optimization, basic deliverability." },
  { name: "Pro", price: "$29/mo", detail: "Higher limits, experiments, advanced controls." }
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <main className="marketing-main marketing-page">
        <h1>Pricing</h1>
        <p>Start in Sandbox for free, then unlock Live and higher throughput when you are ready.</p>
        <section className="marketing-grid">
          {TIERS.map((tier) => (
            <article key={tier.name} className="marketing-card">
              <h2>{tier.name}</h2>
              <p className="pricing-price">{tier.price}</p>
              <p>{tier.detail}</p>
            </article>
          ))}
        </section>
        <Link href="/app" className="marketing-button marketing-button-primary">Start free</Link>
      </main>
    </MarketingShell>
  );
}

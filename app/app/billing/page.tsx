import Link from "next/link";

export default function BillingPage() {
  return (
    <main style={{ padding: "2.5rem", display: "grid", gap: "0.75rem" }}>
      <h1 style={{ margin: 0 }}>Billing</h1>
      <p style={{ margin: 0, color: "#94a3b8" }}>
        Free tier covers Sandbox. Starter/Pro unlock Live and higher limits via Stripe integration.
      </p>
      <Link href="/pricing" className="marketing-button marketing-button-secondary">View plans</Link>
    </main>
  );
}

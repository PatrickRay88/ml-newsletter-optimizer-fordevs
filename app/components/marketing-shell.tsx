import Link from "next/link";

const NAV_ITEMS = [
  { label: "Product", href: "/product" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
  { label: "Security", href: "/security" },
  { label: "About", href: "/about" }
];

export default function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-shell">
      <header className="marketing-header">
        <Link href="/" className="marketing-brand">
          <img src="/dispatchiq-logo.png" alt="DispatchIQ" />
        </Link>
        <nav className="marketing-nav">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href}>{item.label}</Link>
          ))}
        </nav>
        <Link href="/app" className="marketing-button marketing-button-primary">Start free</Link>
      </header>
      {children}
      <footer className="marketing-footer">
        <div>
          <strong>DispatchIQ</strong>
          <p>Optimization layer for developer-first email systems.</p>
        </div>
        <div className="marketing-footer-links">
          <Link href="/docs">Docs</Link>
          <Link href="/security">Security</Link>
          <a href="mailto:contact@dispatchiq.dev">Contact</a>
        </div>
      </footer>
    </div>
  );
}

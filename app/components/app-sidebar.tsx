"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/app" },
  { label: "Onboarding", href: "/app/onboarding" },
  { label: "Integrations", href: "/app/integrations" },
  { label: "Contacts", href: "/app/contacts" },
  { label: "Segments", href: "/app/segments" },
  { label: "Flows", href: "/app/flows" },
  { label: "Broadcasts", href: "/app/broadcasts" },
  { label: "Templates", href: "/app/templates" },
  { label: "Deliverability", href: "/app/deliverability" },
  { label: "Billing", href: "/app/billing" },
  { label: "Settings", href: "/app/settings" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") {
    return pathname === "/app";
  }
  return pathname.startsWith(href);
}

export default function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <img src="/dispatchiq-logo.png" alt="DispatchIQ logo" className="sidebar-logo" />
      </div>

      <div className="environment-pill">Sandbox Environment</div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "nav-link active" : "nav-link"}>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <p>Sandbox mode is isolated from Live and meant for integration validation.</p>
      </div>
    </aside>
  );
}

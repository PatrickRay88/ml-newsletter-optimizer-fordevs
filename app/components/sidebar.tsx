"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Onboarding", href: "/onboarding" },
  { label: "Contacts", href: "/contacts" },
  { label: "Segments", href: "/segments" },
  { label: "Flows", href: "/flows" },
  { label: "Broadcasts", href: "/broadcasts" },
  { label: "Deliverability", href: "/deliverability" },
  { label: "Events", href: "/events" },
  { label: "Templates", href: "/templates" },
  { label: "Settings", href: "/settings" },
  { label: "Dev utilities", href: "/dev" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname.startsWith(href);
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <div className="brand-badge">EA</div>
        <div>
          <strong>Email Autopilot</strong>
          <span>Demo workspace</span>
        </div>
      </div>

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
        <p>Test Mode ready. Use resend.dev inboxes for demo sends.</p>
      </div>
    </aside>
  );
}

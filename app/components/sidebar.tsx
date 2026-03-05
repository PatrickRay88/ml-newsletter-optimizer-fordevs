"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Home", href: "/app" },
  { label: "Onboarding", href: "/app/onboarding" },
  { label: "Contacts", href: "/app/contacts" },
  { label: "Segments", href: "/app/segments" },
  { label: "Flows", href: "/app/flows" },
  { label: "Broadcasts", href: "/app/broadcasts" },
  { label: "Deliverability", href: "/app/deliverability" },
  { label: "Templates", href: "/app/templates" },
  { label: "Dev utilities", href: "/app/dev" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") {
    return pathname === "/app";
  }
  return pathname.startsWith(href);
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <Image
          src="/dispatchiq-logo.svg"
          alt="DispatchIQ logo"
          width={260}
          height={120}
          className="sidebar-logo"
        />
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
        <p>Sandbox ready. Use resend.dev inboxes for rehearsals.</p>
      </div>
    </aside>
  );
}

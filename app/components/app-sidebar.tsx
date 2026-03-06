"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AppUserMenu from "@/app/components/app-user-menu";

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
  { label: "Dev Utilities", href: "/app/dev" },
  { label: "Billing", href: "/app/billing" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") {
    return pathname === "/app";
  }
  return pathname.startsWith(href);
}

type AppSidebarProps = {
  userEmail: string;
};

export default function AppSidebar({ userEmail }: AppSidebarProps) {
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
          priority
        />
      </div>

      <div className="sidebar-account-menu sidebar-account-menu-top">
        <AppUserMenu email={userEmail} />
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

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const PLACEHOLDER_EMAIL = "patrick.d.ray.88@gmail.com";

type AppUserMenuProps = {
  email?: string;
};

export default function AppUserMenu({ email = PLACEHOLDER_EMAIL }: AppUserMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!menuRef.current) {
        return;
      }

      const target = event.target;
      if (target instanceof Node && !menuRef.current.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  return (
    <div className="app-user-menu" ref={menuRef}>
      <button
        type="button"
        className="app-user-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="app-user-email">{email}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="app-user-chevron">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="app-user-dropdown" role="menu" aria-label="Account menu">
          <Link href="/app/settings" className="app-user-action" role="menuitem" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="app-user-icon">
              <path
                d="M12 8.75A3.25 3.25 0 1 0 12 15.25A3.25 3.25 0 1 0 12 8.75Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M19.4 15.2l1.35-1.2l-1.35-2.4l-1.75.15a5.97 5.97 0 0 0-.8-1.4l.75-1.6l-2.35-1.35l-1.2 1.3a6.3 6.3 0 0 0-1.7-.2L11 6.05H8.3L8 7.7c-.6.1-1.15.25-1.7.5L5.1 6.9L2.75 8.25l.75 1.6c-.35.45-.6.95-.8 1.45l-1.75-.2L.6 13.5l1.35 1.2c0 .6.15 1.15.3 1.7l-1.1 1.35l1.7 2.05l1.65-.65c.45.35.95.65 1.45.9l.2 1.7h2.7l.3-1.65c.55-.1 1.1-.3 1.6-.55l1.25 1l2.35-1.35l-.5-1.7c.4-.4.7-.85.95-1.35l1.7.15l1.35-2.4l-1.35-1.2c.05-.3.05-.55.05-.8s0-.5-.05-.75Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Settings</span>
          </Link>

          <button
            type="button"
            className="app-user-action"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              router.push("/");
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="app-user-icon">
              <path
                d="M15.5 4.5h2.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <path
                d="M10 8l-4 4l4 4M6 12h10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Logout</span>
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const STORAGE_KEY = "ea_walkthrough_dismissed";

type WalkthroughStep = {
  id: string;
  title: string;
  description: string;
  href?: string;
  cta?: string;
  target?: string;
  advanceOn?: "click" | "input" | "change";
  optional?: boolean;
  optionalInfo?: string;
  dependsOn?: "webhooks";
};

export default function Walkthrough() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [optionalFlowEnabled, setOptionalFlowEnabled] = useState(false);

  const steps = useMemo<WalkthroughStep[]>(
    () => [
      {
        id: "resend-key",
        title: "Connect Resend",
        description: "Add your Resend API key to enable test sends.",
        href: "/settings",
        cta: "Go to Settings",
        target: "[data-walkthrough='settings-api-key']",
        advanceOn: "change"
      },
      {
        id: "save-settings",
        title: "Create test contacts",
        description: "Save settings to lock in your API key.",
        href: "/settings",
        cta: "Save settings",
        target: "[data-walkthrough='settings-save']",
        advanceOn: "click"
      },
      {
        id: "webhooks-optional",
        title: "Optional: Webhooks",
        description: "Webhooks stream delivery events in real time. This is optional for the demo.",
        href: "/settings",
        cta: "Configure webhooks",
        target: "[data-walkthrough='settings-webhook-toggle']",
        advanceOn: "click",
        optional: true,
        optionalInfo: "Enable webhooks only if you want to demo live event ingestion. Otherwise skip to keep polling-only mode."
      },
      {
        id: "webhook-secret",
        title: "Add webhook secret",
        description: "Paste the webhook secret from Resend to verify signatures.",
        href: "/settings",
        cta: "Enter webhook secret",
        target: "[data-walkthrough='settings-webhook-secret']",
        advanceOn: "change",
        dependsOn: "webhooks"
      },
      {
        id: "create-list",
        title: "Create test contacts",
        description: "Use Dev utilities to generate resend.dev contacts for your demo list.",
        href: "/dev",
        cta: "Open Dev utilities",
        target: "[data-walkthrough='dev-create-list']",
        advanceOn: "click"
      },
      {
        id: "broadcast-name",
        title: "Name a broadcast",
        description: "Create a broadcast draft for your demo campaign.",
        href: "/broadcasts",
        cta: "Open Broadcasts",
        target: "[data-walkthrough='broadcast-name']",
        advanceOn: "change"
      },
      {
        id: "broadcast-create",
        title: "Create the draft",
        description: "Save the broadcast draft so it can be sent.",
        href: "/broadcasts",
        cta: "Create draft",
        target: "[data-walkthrough='broadcast-create']",
        advanceOn: "click"
      },
      {
        id: "broadcast-send",
        title: "Send with optimizer",
        description: "Schedule the broadcast using the optimizer recommendation.",
        href: "/broadcasts",
        cta: "Send with optimizer",
        target: "[data-walkthrough='broadcast-send-optimizer']",
        advanceOn: "click"
      },
      {
        id: "train-models",
        title: "Train ML models",
        description: "Trigger model training for send-time optimization and hygiene risk.",
        href: "/dev",
        cta: "Train models",
        target: "[data-walkthrough='dev-train-models']",
        advanceOn: "click"
      },
      {
        id: "poll-outcomes",
        title: "Poll delivery outcomes",
        description: "Sync delivery results back into the workspace.",
        href: "/dev",
        cta: "Poll outcomes",
        target: "[data-walkthrough='dev-poll-outcomes']",
        advanceOn: "click"
      },
      {
        id: "hygiene-sweep",
        title: "Run hygiene sweep",
        description: "Score deliverability risk and apply suppressions.",
        href: "/dev",
        cta: "Run hygiene sweep",
        target: "[data-walkthrough='dev-hygiene-sweep']",
        advanceOn: "click"
      },
      {
        id: "dashboard",
        title: "Review deliverability",
        description: "Check delivery, clicks, and CTR uplift on the dashboard.",
        href: "/",
        cta: "View Dashboard"
      }
    ],
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const dismissed = window.localStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      setOpen(true);
    }
  }, []);

  const close = useCallback((dismiss?: boolean) => {
    if (dismiss && typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "true");
    }
    setOpen(false);
  }, []);

  const startOver = useCallback(() => {
    setIndex(0);
    setOpen(true);
  }, []);

  const next = useCallback(() => {
    setIndex((current) => {
      let nextIndex = Math.min(current + 1, steps.length - 1);
      while (steps[nextIndex]?.dependsOn === "webhooks" && !optionalFlowEnabled) {
        nextIndex = Math.min(nextIndex + 1, steps.length - 1);
      }
      return nextIndex;
    });
  }, [optionalFlowEnabled, steps]);

  const previous = useCallback(() => {
    setIndex((current) => {
      let prevIndex = Math.max(current - 1, 0);
      while (steps[prevIndex]?.dependsOn === "webhooks" && !optionalFlowEnabled) {
        prevIndex = Math.max(prevIndex - 1, 0);
      }
      return prevIndex;
    });
  }, [optionalFlowEnabled, steps]);

  const current = steps[index];
  const hasNext = index < steps.length - 1;
  const hasPrevious = index > 0;

  const handleCta = useCallback(() => {
    if (current?.href) {
      router.push(current.href);
    }
  }, [current, router]);

  const handleOptional = useCallback(() => {
    setOptionalFlowEnabled(true);
    if (current?.href) {
      router.push(current.href);
    }
  }, [current, router]);

  const handleSkipOptional = useCallback(() => {
    setOptionalFlowEnabled(false);
    setIndex((currentIndex) => {
      let nextIndex = Math.min(currentIndex + 1, steps.length - 1);
      while (steps[nextIndex]?.dependsOn === "webhooks" && !optionalFlowEnabled) {
        nextIndex = Math.min(nextIndex + 1, steps.length - 1);
      }
      return nextIndex;
    });
  }, [optionalFlowEnabled, steps]);

  useEffect(() => {
    const selector = current?.target;
    if (!open || !selector || typeof window === "undefined") {
      setTargetRect(null);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const resolveTarget = () => {
      if (cancelled) {
        return;
      }
      const element = document.querySelector(selector);
      if (!element) {
        setTargetRect(null);
        if (attempts < 12) {
          attempts += 1;
          retryTimer = setTimeout(resolveTarget, 250);
        }
        return;
      }
      element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      setTargetRect(rect);
    };

    resolveTarget();
    const handleScroll = () => resolveTarget();
    const handleResize = () => resolveTarget();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [current?.target, open, pathname]);

  useEffect(() => {
    const selector = current?.target;
    if (!open || !selector || !current.advanceOn || typeof window === "undefined") {
      return undefined;
    }

    if (current.optional && !optionalFlowEnabled) {
      return undefined;
    }

    const element = document.querySelector(selector) as HTMLElement | null;
    if (!element) {
      return undefined;
    }

    const handler = (event: Event) => {
      if (current.advanceOn === "input" || current.advanceOn === "change") {
        const target = event.target as HTMLInputElement | HTMLSelectElement | null;
        if (target && typeof target.value === "string" && target.value.trim().length > 0) {
          setIndex((prev) => {
            let nextIndex = Math.min(prev + 1, steps.length - 1);
            while (steps[nextIndex]?.dependsOn === "webhooks" && !optionalFlowEnabled) {
              nextIndex = Math.min(nextIndex + 1, steps.length - 1);
            }
            return nextIndex;
          });
        }
      } else if (current.advanceOn === "click") {
        if (current.optional) {
          setOptionalFlowEnabled(true);
        }
        setIndex((prev) => {
          let nextIndex = Math.min(prev + 1, steps.length - 1);
          while (steps[nextIndex]?.dependsOn === "webhooks" && !optionalFlowEnabled) {
            nextIndex = Math.min(nextIndex + 1, steps.length - 1);
          }
          return nextIndex;
        });
      }
    };

    element.addEventListener(current.advanceOn, handler);

    return () => {
      element.removeEventListener(current.advanceOn as string, handler);
    };
  }, [current, open, optionalFlowEnabled, steps]);

  const highlightMessage = current?.href && current.href !== pathname
    ? `Navigate to ${current.href} to complete this step.`
    : targetRect
      ? "Highlighted area shows what to do next."
      : "Waiting for the highlighted action to appear.";

  if (!open) {
    return (
      <button
        type="button"
        onClick={startOver}
        style={{
          position: "fixed",
          bottom: "1.5rem",
          right: "1.5rem",
          padding: "0.75rem 1.25rem",
          borderRadius: "999px",
          border: "none",
          background: "#38bdf8",
          color: "#0f172a",
          fontWeight: 600,
          cursor: "pointer",
          zIndex: 40
        }}
      >
        Start walkthrough
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "transparent",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: "1.5rem",
        pointerEvents: "none"
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.35)",
          pointerEvents: "none"
        }}
      />
      {targetRect && (
        <div
          style={{
            position: "fixed",
            top: Math.max(targetRect.top - 8, 8),
            left: Math.max(targetRect.left - 8, 8),
            width: targetRect.width + 16,
            height: targetRect.height + 16,
            borderRadius: "0.75rem",
            border: "2px solid #38bdf8",
            boxShadow: "0 0 24px rgba(56, 189, 248, 0.65)",
            pointerEvents: "none",
            transition: "all 0.2s ease"
          }}
        />
      )}
      <div
        style={{
          maxWidth: "480px",
          width: "100%",
          position: "fixed",
          right: "1.5rem",
          bottom: "1.5rem",
          background: "#0b1220",
          borderRadius: "1rem",
          border: "1px solid #1f2937",
          padding: "1.5rem",
          display: "grid",
          gap: "1rem",
          boxShadow: "0 20px 50px rgba(15, 23, 42, 0.55)",
          pointerEvents: "auto"
        }}
      >
        <header style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
            Step {index + 1} of {steps.length}
          </span>
          <h2 style={{ margin: 0, fontSize: "1.4rem" }}>{current?.title}</h2>
          <p style={{ margin: 0, color: "#cbd5f5" }}>{current?.description}</p>
        </header>

        <div
          style={{
            borderRadius: "0.75rem",
            border: "1px dashed #334155",
            padding: "0.75rem",
            color: "#94a3b8",
            fontSize: "0.9rem"
          }}
        >
          {highlightMessage}
        </div>

        {current?.optional && current.optionalInfo && (
          <div
            style={{
              borderRadius: "0.75rem",
              border: "1px solid #1f2937",
              background: "#0f172a",
              padding: "0.75rem",
              color: "#94a3b8",
              fontSize: "0.9rem"
            }}
          >
            {current.optionalInfo}
          </div>
        )}

        {current?.href && (!current.optional || optionalFlowEnabled) && (
          <button
            type="button"
            onClick={current.optional ? handleOptional : handleCta}
            style={{
              width: "100%",
              padding: "0.75rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#38bdf8",
              color: "#0f172a",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            {current.cta ?? "Open page"}
          </button>
        )}

        {current?.optional && !optionalFlowEnabled && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={handleOptional}
              style={{
                flex: "1 1 180px",
                padding: "0.65rem",
                borderRadius: "0.65rem",
                border: "1px solid #38bdf8",
                background: "#0f172a",
                color: "#e2e8f0",
                cursor: "pointer"
              }}
            >
              Configure now
            </button>
            <button
              type="button"
              onClick={handleSkipOptional}
              style={{
                flex: "1 1 120px",
                padding: "0.65rem",
                borderRadius: "0.65rem",
                border: "1px solid #334155",
                background: "transparent",
                color: "#94a3b8",
                cursor: "pointer"
              }}
            >
              Skip
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={previous}
            disabled={!hasPrevious}
            style={{
              flex: "1 1 120px",
              padding: "0.65rem",
              borderRadius: "0.65rem",
              border: "1px solid #334155",
              background: hasPrevious ? "#0f172a" : "#111827",
              color: hasPrevious ? "#e2e8f0" : "#475569",
              cursor: hasPrevious ? "pointer" : "default"
            }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={next}
            disabled={!hasNext}
            style={{
              flex: "1 1 120px",
              padding: "0.65rem",
              borderRadius: "0.65rem",
              border: "1px solid #334155",
              background: hasNext ? "#1e293b" : "#111827",
              color: hasNext ? "#e2e8f0" : "#475569",
              cursor: hasNext ? "pointer" : "default"
            }}
          >
            Next
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "space-between", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => close(true)}
            style={{
              padding: "0.5rem",
              border: "none",
              background: "transparent",
              color: "#94a3b8",
              cursor: "pointer"
            }}
          >
            Don’t show again
          </button>
          <button
            type="button"
            onClick={() => close()}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "0.5rem",
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#e2e8f0",
              cursor: "pointer"
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

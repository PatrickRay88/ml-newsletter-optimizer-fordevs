"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ContactStatus } from "@prisma/client";
import type { ContactListItem } from "@/lib/contacts";

const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: "1.5rem"
};

const CELL_STYLE: React.CSSProperties = {
  borderBottom: "1px solid #1f2937",
  padding: "0.5rem 0.75rem",
  textAlign: "left"
};

type ContactsClientProps = {
  contacts: ContactListItem[];
  statusOptions: ContactStatus[];
  filter: {
    status: ContactStatus | null;
    tag: string | null;
    timezone: string | null;
  };
  distinct: {
    timezones: string[];
    tags: string[];
  };
};

type ImportStatus = {
  type: "idle" | "success" | "error";
  message?: string;
};

type AddStatus = {
  type: "idle" | "success" | "error";
  message?: string;
};

export default function ContactsClient({ contacts, statusOptions, filter, distinct }: ContactsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [csvInput, setCsvInput] = useState("");
  const [importStatus, setImportStatus] = useState<ImportStatus>({ type: "idle" });
  const [addStatus, setAddStatus] = useState<AddStatus>({ type: "idle" });
  const [emailInput, setEmailInput] = useState("");
  const [timezoneInput, setTimezoneInput] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  const activeFilters = useMemo(() => ({
    status: filter.status ?? undefined,
    tag: filter.tag ?? undefined,
    timezone: filter.timezone ?? undefined
  }), [filter]);

  const applyFilters = useCallback((updates: Partial<typeof activeFilters>) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const next = { ...activeFilters, ...updates };

    Object.entries(next).forEach(([key, value]) => {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });

    router.push(`/contacts?${params.toString()}`);
  }, [activeFilters, router, searchParams]);

  const handleImport = useCallback(async () => {
    if (!csvInput.trim()) {
      setImportStatus({ type: "error", message: "Provide CSV content before importing" });
      return;
    }

    try {
      const response = await fetch("/api/contacts/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ csv: csvInput })
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof body.message === "string" ? body.message : "Import failed";
        throw new Error(message);
      }

      setImportStatus({
        type: "success",
        message: `Created ${body.result?.created ?? 0}, Updated ${body.result?.updated ?? 0}`
      });
      setCsvInput("");
      router.refresh();
    } catch (error) {
      setImportStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Import failed"
      });
    }
  }, [csvInput, router]);

  const handleAdd = useCallback(async () => {
    if (!emailInput.trim()) {
      setAddStatus({ type: "error", message: "Email is required" });
      return;
    }

    try {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.trim(),
          timezone: timezoneInput.trim() || null,
          tags: tagsInput.trim()
        })
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success === false) {
        const message = typeof body.message === "string" ? body.message : "Unable to add contact";
        throw new Error(message);
      }

      setAddStatus({ type: "success", message: "Contact saved" });
      setEmailInput("");
      setTimezoneInput("");
      setTagsInput("");
      router.refresh();
    } catch (error) {
      setAddStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Unable to add contact"
      });
    }
  }, [emailInput, router, tagsInput, timezoneInput]);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "1.5rem", padding: "2rem" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Contacts</h1>
        <p style={{ margin: 0, color: "#94a3b8" }}>
          View synthetic contacts and filter by status, tag, or timezone. Paste CSV data to import additional records.
        </p>
      </header>

      <section style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <span>Status</span>
          <select
            value={activeFilters.status ?? ""}
            onChange={(event) => {
              const rawValue = event.target.value;
              applyFilters({
                status: rawValue ? (rawValue as ContactStatus) : undefined
              });
            }}
              style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
          >
            <option value="">All statuses</option>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <span>Tag</span>
          <select
            value={activeFilters.tag ?? ""}
            onChange={(event) => applyFilters({ tag: event.target.value || undefined })}
            style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
          >
            <option value="">All tags</option>
            {distinct.tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <span>Timezone</span>
          <select
            value={activeFilters.timezone ?? ""}
            onChange={(event) => applyFilters({ timezone: event.target.value || undefined })}
            style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
          >
            <option value="">All timezones</option>
            {distinct.timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>Add contact</h2>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>Email</span>
            <input
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="contact@resend.dev"
              style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>Timezone</span>
            <input
              value={timezoneInput}
              onChange={(event) => setTimezoneInput(event.target.value)}
              placeholder="America/New_York"
              style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>Tags</span>
            <input
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              placeholder="trial, north-america"
              style={{ padding: "0.5rem", borderRadius: "0.5rem", background: "#0f172a", color: "#e2e8f0" }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <button
            type="button"
            onClick={handleAdd}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#38bdf8",
              color: "#0f172a",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Save contact
          </button>
          {addStatus.type !== "idle" && (
            <span
              style={{
                color: addStatus.type === "success" ? "#bbf7d0" : "#fecaca",
                fontWeight: 500
              }}
            >
              {addStatus.message}
            </span>
          )}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>Import CSV</h2>
        <textarea
          value={csvInput}
          onChange={(event) => setCsvInput(event.target.value)}
          placeholder="email,timezone,tags\nexample@resend.dev,America/New_York,test-list"
          rows={6}
          style={{
            width: "100%",
            padding: "0.75rem",
            borderRadius: "0.75rem",
            background: "#0f172a",
            color: "#e2e8f0",
            border: "1px solid #1e293b"
          }}
        />
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <button
            type="button"
            onClick={handleImport}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#34d399",
              color: "#022c22",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Import contacts
          </button>
          {importStatus.type !== "idle" && (
            <span
              style={{
                color: importStatus.type === "success" ? "#bbf7d0" : "#fecaca",
                fontWeight: 500
              }}
            >
              {importStatus.message}
            </span>
          )}
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: "0.75rem" }}>Contact list ({contacts.length})</h2>
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              <th style={CELL_STYLE}>Email</th>
              <th style={CELL_STYLE}>Status</th>
              <th style={CELL_STYLE}>Timezone</th>
              <th style={CELL_STYLE}>Tags</th>
              <th style={CELL_STYLE}>Last Sent</th>
              <th style={CELL_STYLE}>Last Event</th>
              <th style={CELL_STYLE}>Hygiene Risk</th>
              <th style={CELL_STYLE}>Hygiene Score</th>
            </tr>
          </thead>
          <tbody>
            {contacts.length === 0 ? (
              <tr>
                <td style={{ ...CELL_STYLE, textAlign: "center" }} colSpan={8}>
                  No contacts match the selected filters.
                </td>
              </tr>
            ) : (
              contacts.map((contact) => (
                <tr key={contact.id}>
                  <td style={CELL_STYLE}>{contact.email}</td>
                  <td style={CELL_STYLE}>{contact.status}</td>
                  <td style={CELL_STYLE}>{contact.timezone ?? "-"}</td>
                  <td style={CELL_STYLE}>{contact.tags.join(", ") || "-"}</td>
                  <td style={CELL_STYLE}>{contact.lastMessageSentAt ? new Date(contact.lastMessageSentAt).toLocaleString() : "-"}</td>
                  <td style={CELL_STYLE}>{contact.lastEventAt ? new Date(contact.lastEventAt).toLocaleString() : "-"}</td>
                  <td style={CELL_STYLE}>{contact.hygieneRiskLevel}</td>
                  <td style={CELL_STYLE}>{typeof contact.hygieneScore === "number" ? contact.hygieneScore.toFixed(1) : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const templates = await prisma.template.findMany({
    orderBy: { createdAt: "asc" }
  });

  return (
    <section style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Templates</h1>
        <p style={{ margin: 0, color: "#94a3b8" }}>
          Review the pre-seeded templates available for broadcasts. Templates are view only in this version.
        </p>
      </header>

      <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {templates.map((template) => (
          <article
            key={template.id}
            style={{
              border: "1px solid #1e293b",
              borderRadius: "1rem",
              padding: "1.5rem",
              background: "rgba(15, 23, 42, 0.85)",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem"
            }}
          >
            <header>
              <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{template.name}</h2>
              <p style={{ margin: "0.25rem 0", color: "#94a3b8" }}>{template.category ?? "General"}</p>
            </header>
            <div>
              <strong>Subject:</strong> {template.subject}
            </div>
            {template.previewText && (
              <div style={{ color: "#cbd5f5" }}>
                <strong>Preview:</strong> {template.previewText}
              </div>
            )}
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", color: "#38bdf8" }}>View HTML</summary>
              <pre
                style={{
                  marginTop: "0.75rem",
                  padding: "1rem",
                  background: "#0f172a",
                  borderRadius: "0.75rem",
                  overflowX: "auto",
                  color: "#e2e8f0"
                }}
              >
                {template.html}
              </pre>
            </details>
            <footer style={{ fontSize: "0.85rem", color: "#64748b" }}>
              Updated {new Date(template.updatedAt).toLocaleString()}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

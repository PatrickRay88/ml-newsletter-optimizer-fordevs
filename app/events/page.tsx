import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatTimestamp(value: Date): string {
  return new Date(value).toLocaleString();
}

export default async function EventsPage() {
  const events = await prisma.event.findMany({
    orderBy: { timestamp: "desc" },
    take: 30,
    include: { contact: true }
  });

  return (
    <main style={{ padding: "3rem", display: "grid", gap: "2rem" }}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <h1 style={{ margin: 0 }}>Events</h1>
        <p style={{ margin: 0, color: "#94a3b8", maxWidth: "46rem" }}>
          Track lifecycle events that trigger flows and influence segmentation. Post events to /api/events to drive
          automation.
        </p>
      </header>

      <section style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <article style={{ border: "1px solid #1f2937", borderRadius: "1rem", padding: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>How to send an event</h2>
          <p style={{ color: "#94a3b8" }}>POST /api/events with the payload below.</p>
          <pre
            style={{
              background: "#0b1120",
              borderRadius: "0.75rem",
              padding: "1rem",
              color: "#e2e8f0",
              overflowX: "auto",
              margin: 0
            }}
          >{`{
  "contactEmail": "user@example.com",
  "eventName": "user.signup",
  "occurredAt": "2026-01-31T18:10:00Z",
  "properties": {
    "plan": "starter"
  }
}`}</pre>
        </article>

        <article style={{ border: "1px solid #1f2937", borderRadius: "1rem", padding: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>Recent events</h2>
          {events.length === 0 ? (
            <p style={{ color: "#94a3b8" }}>No events recorded yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
              {events.map((event) => (
                <li
                  key={event.id}
                  style={{
                    border: "1px solid #1f2937",
                    borderRadius: "0.75rem",
                    padding: "0.75rem 1rem",
                    background: "rgba(15, 23, 42, 0.65)"
                  }}
                >
                  <strong>{event.eventName}</strong>
                  <p style={{ margin: "0.35rem 0 0", color: "#94a3b8" }}>
                    {event.contact?.email ?? "Unknown contact"} • {formatTimestamp(event.timestamp)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </main>
  );
}

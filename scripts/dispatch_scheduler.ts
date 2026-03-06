import "dotenv/config";

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;

function parseIntervalMs(input: string | undefined): number {
  if (!input) {
    return DEFAULT_INTERVAL_MS;
  }

  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 5_000) {
    return DEFAULT_INTERVAL_MS;
  }

  return Math.floor(parsed);
}

function resolveBaseUrl(): string {
  const fromEnv = process.env.APP_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}

async function runTick(baseUrl: string) {
  const started = Date.now();
  const endpoint = `${baseUrl}/api/jobs/poll-email-status`;

  try {
    const response = await fetch(endpoint, { method: "POST" });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok || payload.success === false) {
      const message = typeof payload.message === "string" ? payload.message : "poll failed";
      console.error(`[scheduler] ${new Date().toISOString()} ${message}`);
      return;
    }

    const summary = (payload.summary ?? {}) as Record<string, unknown>;
    const dispatchSummary = (payload.dispatchSummary ?? {}) as Record<string, unknown>;
    const batchesProcessed = Number(payload.batchesProcessed ?? 1);

    console.log(
      `[scheduler] ${new Date().toISOString()} batches=${Number.isFinite(batchesProcessed) ? batchesProcessed : 1} checked=${summary.totalChecked ?? 0} delivered=${summary.delivered ?? 0} bounced=${summary.bounced ?? 0} dispatched=${dispatchSummary.sent ?? 0} (${Date.now() - started}ms)`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected scheduler error";
    console.error(`[scheduler] ${new Date().toISOString()} ${message}`);
  }
}

async function main() {
  const baseUrl = resolveBaseUrl();
  const intervalMs = parseIntervalMs(process.env.DISPATCH_SCHEDULER_INTERVAL_MS);

  console.log(`[scheduler] starting at ${baseUrl} interval=${intervalMs}ms`);
  await runTick(baseUrl);

  setInterval(() => {
    void runTick(baseUrl);
  }, intervalMs);
}

void main();

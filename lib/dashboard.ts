import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type BroadcastMetric = {
  id: string;
  name: string;
  createdAt: Date;
  total: number;
  delivered: number;
  bounced: number;
  suppressed: number;
  clicks: number;
  actualCtr: number;
  baselineCtr: number;
  upliftPct: number;
};

export type DashboardSummary = {
  totals: {
    total: number;
    delivered: number;
    bounced: number;
    suppressed: number;
    clicks: number;
    actualCtr: number;
    baselineCtr: number;
    upliftPct: number;
  };
  broadcasts: BroadcastMetric[];
  daily: {
    date: string;
    sends: number;
    clicks: number;
  }[];
  autopilot: {
    mode: string;
    testModeEnabled: boolean;
    optimizerActive: boolean;
    hygieneActive: boolean;
    lastOptimizerDecisionAt: Date | null;
    lastHygieneRunAt: Date | null;
  };
};

function extractNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function computeCtr(clicks: number, delivered: number): number {
  if (!delivered) {
    return 0;
  }
  return Number((clicks / delivered).toFixed(4));
}

function computeUplift(actual: number, baseline: number): number {
  if (baseline === 0) {
    return actual > 0 ? 1 : 0;
  }
  return Number((((actual - baseline) / baseline) * 100).toFixed(2));
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDailySeries(messages: { sentAt: Date | null; outcome: { clickedAt: Date | null } | null }[]): {
  date: string;
  sends: number;
  clicks: number;
}[] {
  const today = new Date();
  const endKey = toDateKey(today);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 6);
  const series: { date: string; sends: number; clicks: number }[] = [];
  const map = new Map<string, { sends: number; clicks: number }>();

  for (let i = 0; i < 7; i += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const key = toDateKey(date);
    map.set(key, { sends: 0, clicks: 0 });
    series.push({ date: key, sends: 0, clicks: 0 });
  }

  messages.forEach((message) => {
    if (!message.sentAt) {
      return;
    }
    const key = toDateKey(message.sentAt);
    if (key < toDateKey(start) || key > endKey) {
      return;
    }
    const bucket = map.get(key);
    if (!bucket) {
      return;
    }
    bucket.sends += 1;
    if (message.outcome?.clickedAt) {
      bucket.clicks += 1;
    }
  });

  return series.map((entry) => {
    const values = map.get(entry.date) ?? { sends: 0, clicks: 0 };
    return { date: entry.date, sends: values.sends, clicks: values.clicks };
  });
}

export async function loadDashboardMetrics(): Promise<DashboardSummary> {
  const [broadcasts, settings, lastDecision, lastHygiene] = await Promise.all([
    prisma.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        messages: {
          include: {
            outcome: true
          }
        }
      }
    }),
    prisma.settings.findFirst(),
    prisma.optimizerDecision.findFirst({
      orderBy: { createdAt: "desc" }
    }),
    prisma.hygieneEvaluation.findFirst({
      orderBy: { createdAt: "desc" }
    })
  ]);

  const broadcastMetrics: BroadcastMetric[] = broadcasts.map((broadcast) => {
    let total = 0;
    let delivered = 0;
    let bounced = 0;
    let suppressed = 0;
    let clicks = 0;
    let actualProbabilitySum = 0;
    let baselineProbabilitySum = 0;

    broadcast.messages.forEach((message) => {
      total += 1;
      const outcome = message.outcome;
      if (!outcome) {
        return;
      }

      if (outcome.deliveredAt) {
        delivered += 1;
      }
      if (outcome.bouncedAt) {
        bounced += 1;
      }
      if (outcome.suppressedAt) {
        suppressed += 1;
      }
      if (outcome.clickedAt) {
        clicks += 1;
      }

      const metadata = outcome.metadata as Prisma.JsonObject | null;
      if (metadata) {
        const probability = extractNumber(metadata.probability);
        const baselineProbability = extractNumber(metadata.baselineProbability);
        if (probability !== null) {
          actualProbabilitySum += probability;
        }
        if (baselineProbability !== null) {
          baselineProbabilitySum += baselineProbability;
        }
      }
    });

    const actualCtr = computeCtr(clicks, delivered);
    const baselineCtr = total ? Number((baselineProbabilitySum / total).toFixed(4)) : 0;
    const upliftPct = computeUplift(actualCtr, baselineCtr);

    return {
      id: broadcast.id,
      name: broadcast.name,
      createdAt: broadcast.createdAt,
      total,
      delivered,
      bounced,
      suppressed,
      clicks,
      actualCtr,
      baselineCtr,
      upliftPct
    };
  });

  const totals = broadcastMetrics.reduce(
    (acc, metric) => ({
      total: acc.total + metric.total,
      delivered: acc.delivered + metric.delivered,
      bounced: acc.bounced + metric.bounced,
      suppressed: acc.suppressed + metric.suppressed,
      clicks: acc.clicks + metric.clicks,
      baselineSum: acc.baselineSum + metric.baselineCtr * metric.total
    }),
    {
      total: 0,
      delivered: 0,
      bounced: 0,
      suppressed: 0,
      clicks: 0,
      baselineSum: 0
    }
  );

  const overallActualCtr = totals.delivered ? Number((totals.clicks / totals.delivered).toFixed(4)) : 0;
  const overallBaselineCtr = totals.total ? Number((totals.baselineSum / totals.total).toFixed(4)) : 0;
  const overallUplift = computeUplift(overallActualCtr, overallBaselineCtr);

  const allMessages = broadcasts.flatMap((broadcast) => broadcast.messages);
  const daily = buildDailySeries(allMessages);

  return {
    totals: {
      total: totals.total,
      delivered: totals.delivered,
      bounced: totals.bounced,
      suppressed: totals.suppressed,
      clicks: totals.clicks,
      actualCtr: overallActualCtr,
      baselineCtr: overallBaselineCtr,
      upliftPct: overallUplift
    },
    broadcasts: broadcastMetrics,
    daily,
    autopilot: {
      mode: settings?.mode ?? "TEST",
      testModeEnabled: settings?.testModeEnabled ?? true,
      optimizerActive: Boolean(lastDecision),
      hygieneActive: Boolean(lastHygiene),
      lastOptimizerDecisionAt: lastDecision?.createdAt ?? null,
      lastHygieneRunAt: lastHygiene?.createdAt ?? null
    }
  };
}

import { ContactStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { getLatestRealSendTimeModelVersion } from "./model_versions";

const HOURS_PER_WEEK = 7 * 24;
const SEGMENT_TAG_PREFIX = "segment=";
const SMOOTHING_ALPHA = 5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type Histogram = {
  sends: number[];
  clicks: number[];
};

type Histograms = {
  global: Histogram;
  segments: Map<string, Histogram>;
};

type StoredHistogram = {
  sends: number[];
  clicks: number[];
};

const HISTOGRAM_CACHE_TTL_MS = 60 * 1000;

let histogramCache: {
  data: Histograms;
  fetchedAt: number;
} | null = null;

function createHistogram(): Histogram {
  return {
    sends: Array(HOURS_PER_WEEK).fill(0),
    clicks: Array(HOURS_PER_WEEK).fill(0)
  };
}

function hourOfWeek(date: Date): number {
  return date.getUTCDay() * 24 + date.getUTCHours();
}

function getSegmentTag(tags: string[]): string | null {
  const tag = tags.find((value) => value.startsWith(SEGMENT_TAG_PREFIX));
  return tag ? tag.split("=")[1] ?? null : null;
}

function histogramHasData(histogram: Histogram | null | undefined): boolean {
  return Boolean(histogram && histogram.sends.some((value) => value > 0));
}

function isStoredHistogram(value: unknown): value is StoredHistogram {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as StoredHistogram;
  return Array.isArray(candidate.sends) && Array.isArray(candidate.clicks);
}

function loadHistogramsFromModel(metrics: unknown): Histograms | null {
  if (!metrics || typeof metrics !== "object") {
    return null;
  }
  const payload = metrics as {
    global?: StoredHistogram;
    segments?: Record<string, StoredHistogram>;
  };
  if (!payload.global || !isStoredHistogram(payload.global)) {
    return null;
  }

  const global = {
    sends: payload.global.sends.slice(0, HOURS_PER_WEEK),
    clicks: payload.global.clicks.slice(0, HOURS_PER_WEEK)
  };

  const segments = new Map<string, Histogram>();
  if (payload.segments && typeof payload.segments === "object") {
    Object.entries(payload.segments).forEach(([segment, histogram]) => {
      if (isStoredHistogram(histogram)) {
        segments.set(segment, {
          sends: histogram.sends.slice(0, HOURS_PER_WEEK),
          clicks: histogram.clicks.slice(0, HOURS_PER_WEEK)
        });
      }
    });
  }

  return { global, segments };
}

async function buildHistograms(): Promise<Histograms> {
  const messages = await prisma.message.findMany({
    where: {
      sentAt: {
        not: null
      }
    },
    select: {
      sentAt: true,
      contact: {
        select: {
          tags: true
        }
      },
      outcome: {
        select: {
          clickedAt: true
        }
      }
    }
  });

  const global = createHistogram();
  const segments = new Map<string, Histogram>();

  messages.forEach((message) => {
    if (!message.sentAt) {
      return;
    }
    const hour = hourOfWeek(message.sentAt);
    global.sends[hour] += 1;
    if (message.outcome?.clickedAt) {
      global.clicks[hour] += 1;
    }

    const segment = getSegmentTag(message.contact.tags ?? []);
    if (segment) {
      let histogram = segments.get(segment);
      if (!histogram) {
        histogram = createHistogram();
        segments.set(segment, histogram);
      }
      histogram.sends[hour] += 1;
      if (message.outcome?.clickedAt) {
        histogram.clicks[hour] += 1;
      }
    }
  });

  return { global, segments };
}

async function buildContactHistogram(contactId: string): Promise<Histogram | null> {
  const messages = await prisma.message.findMany({
    where: {
      contactId,
      sentAt: {
        not: null
      }
    },
    select: {
      sentAt: true,
      outcome: {
        select: {
          clickedAt: true
        }
      }
    }
  });

  if (messages.length === 0) {
    return null;
  }

  const histogram = createHistogram();
  messages.forEach((message) => {
    if (!message.sentAt) {
      return;
    }
    const hour = hourOfWeek(message.sentAt);
    histogram.sends[hour] += 1;
    if (message.outcome?.clickedAt) {
      histogram.clicks[hour] += 1;
    }
  });

  return histogramHasData(histogram) ? histogram : null;
}

async function getHistograms(): Promise<Histograms> {
  const now = Date.now();
  if (histogramCache && now - histogramCache.fetchedAt < HISTOGRAM_CACHE_TTL_MS) {
    return histogramCache.data;
  }

  const latestModel = await prisma.modelVersion.findFirst({
    where: { modelName: "send_time_v1" },
    orderBy: { trainedAt: "desc" }
  });

  if (latestModel?.metrics) {
    const stored = loadHistogramsFromModel(latestModel.metrics);
    if (stored) {
      histogramCache = {
        data: stored,
        fetchedAt: now
      };
      return stored;
    }
  }

  const data = await buildHistograms();
  histogramCache = {
    data,
    fetchedAt: now
  };

  return data;
}

function computePrior(histogram: Histogram): number {
  const totalSends = histogram.sends.reduce((sum, value) => sum + value, 0);
  const totalClicks = histogram.clicks.reduce((sum, value) => sum + value, 0);
  if (!totalSends) {
    return 0.05;
  }
  return totalClicks / totalSends;
}

function scoreHistogram(hour: number, histogram: Histogram, prior: number): number {
  const sends = histogram.sends[hour] ?? 0;
  const clicks = histogram.clicks[hour] ?? 0;
  return (clicks + SMOOTHING_ALPHA * prior) / (sends + SMOOTHING_ALPHA);
}

function pickBestHour(
  histogram: Histogram,
  fallback: Histogram,
  useFallbackPrior = false
): { hour: number; score: number; baseline: number } {
  const fallbackPrior = computePrior(fallback);
  const prior = useFallbackPrior ? fallbackPrior : computePrior(histogram);
  let bestHour = 0;
  let bestScore = -Infinity;

  for (let hour = 0; hour < HOURS_PER_WEEK; hour += 1) {
    const score = scoreHistogram(hour, histogram, prior);
    if (score > bestScore) {
      bestHour = hour;
      bestScore = score;
    }
  }

  const baselineScore = scoreHistogram(bestHour, fallback, fallbackPrior);

  return {
    hour: bestHour,
    score: bestScore,
    baseline: baselineScore
  };
}

function getNextDateForHour(reference: Date, hourOfWeekValue: number, timezone?: string | null): Date {
  const base = new Date(reference);
  if (timezone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    }).formatToParts(reference);

    const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");

    base.setUTCFullYear(getPart("year"), getPart("month") - 1, getPart("day"));
    base.setUTCHours(getPart("hour"), getPart("minute"), getPart("second"), 0);
  }

  const result = new Date(base);
  const utcHour = hourOfWeekValue % 24;
  const dayOffset = Math.floor(hourOfWeekValue / 24);
  result.setUTCDate(result.getUTCDate() + ((dayOffset - result.getUTCDay() + 7) % 7));
  result.setUTCHours(utcHour, 0, 0, 0);

  if (result <= base) {
    result.setUTCDate(result.getUTCDate() + 7);
  }

  return result;
}

type StoredSendTimeRecommendation = {
  recommendedHour: number;
  baselineScore: number;
  sourceModel: string;
  threshold: number | null;
};

function parseStoredSendTimeRecommendation(payload: unknown): StoredSendTimeRecommendation | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const candidate = payload as {
    recommendedHour?: unknown;
    baselineScore?: unknown;
    sourceModel?: unknown;
    threshold?: unknown;
  };

  const recommendedHour = Number(candidate.recommendedHour);
  const baselineScore = Number(candidate.baselineScore ?? 0);
  const sourceModel = typeof candidate.sourceModel === "string" ? candidate.sourceModel : "send_time_real_v1";
  const threshold =
    typeof candidate.threshold === "number" && Number.isFinite(candidate.threshold)
      ? candidate.threshold
      : null;

  if (!Number.isInteger(recommendedHour) || recommendedHour < 0 || recommendedHour >= HOURS_PER_WEEK) {
    return null;
  }

  if (!Number.isFinite(baselineScore)) {
    return null;
  }

  return {
    recommendedHour,
    baselineScore,
    sourceModel,
    threshold
  };
}

export type OptimizerRecommendation = {
  recommendedHour: number | null;
  recommendedAt: Date | null;
  score: number;
  baselineScore: number;
  reason: string;
  throttled: boolean;
};

export async function recommendSendTime(contactId: string, referenceDate = new Date()): Promise<OptimizerRecommendation> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: {
      id: true,
      status: true,
      tags: true,
      timezone: true,
      lastMessageSentAt: true
    }
  });

  if (!contact) {
    throw new Error("Contact not found");
  }

  if (contact.status !== ContactStatus.ACTIVE) {
    return {
      recommendedHour: null,
      recommendedAt: null,
      score: 0,
      baselineScore: 0,
      reason: "Contact not active",
      throttled: false
    };
  }

  const realModel = await getLatestRealSendTimeModelVersion();
  if (realModel) {
    const realPrediction = await prisma.prediction.findFirst({
      where: {
        modelVersionId: realModel.id,
        contactId: contact.id,
        targetType: "send_time_recommendation"
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (realPrediction && typeof realPrediction.score === "number" && Number.isFinite(realPrediction.score)) {
      const stored = parseStoredSendTimeRecommendation(realPrediction.payload);
      if (stored) {
        const hour = stored.recommendedHour;
        const score = realPrediction.score;
        const baseline = stored.baselineScore;
        let recommendedAt = getNextDateForHour(referenceDate, hour, contact.timezone ?? undefined);
        let throttled = false;

        if (contact.lastMessageSentAt) {
          const earliest = new Date(contact.lastMessageSentAt.getTime() + ONE_DAY_MS);
          if (earliest > referenceDate) {
            throttled = true;
          }

          if (recommendedAt < earliest) {
            recommendedAt = getNextDateForHour(earliest, hour, contact.timezone ?? undefined);
          }
        }

        const rationale = throttled
          ? `Real model recommendation (${stored.sourceModel}) • throttled 24h cooldown`
          : `Real model recommendation (${stored.sourceModel})`;

        await prisma.optimizerDecision.create({
          data: {
            contactId: contact.id,
            recommendedHour: hour,
            score,
            baselineScore: baseline,
            rationale: {
              sourceModel: stored.sourceModel,
              modelVersionId: realModel.id,
              threshold: stored.threshold,
              generatedAt: referenceDate.toISOString(),
              recommendedAt: recommendedAt.toISOString(),
              throttled,
              usedRealModel: true
            }
          }
        });

        return {
          recommendedHour: hour,
          recommendedAt,
          score,
          baselineScore: baseline,
          reason: rationale,
          throttled
        };
      }
    }
  }

  const histograms = await getHistograms();
  const contactHistogram = await buildContactHistogram(contact.id);
  const segment = getSegmentTag(contact.tags ?? []);
  const segmentHistogram = segment ? histograms.segments.get(segment) : null;
  const segmentHasData = histogramHasData(segmentHistogram ?? null);
  const fallbackHistogram = segmentHasData ? (segmentHistogram as Histogram) : histograms.global;

  const { hour, score, baseline } = contactHistogram
    ? pickBestHour(contactHistogram, fallbackHistogram, true)
    : segmentHasData
      ? pickBestHour(fallbackHistogram, histograms.global)
      : pickBestHour(histograms.global, histograms.global);
  let recommendedAt = getNextDateForHour(referenceDate, hour, contact.timezone ?? undefined);
  let throttled = false;
  let rationale = "Global recommendation";

  if (contactHistogram) {
    rationale = segment
      ? `Contact + segment recommendation (${segment})`
      : "Contact-based recommendation";
  } else if (segment) {
    rationale = `Segment-based recommendation (${segment})`;
  }

  if (contact.lastMessageSentAt) {
    const earliest = new Date(contact.lastMessageSentAt.getTime() + ONE_DAY_MS);
    if (earliest > referenceDate) {
      throttled = true;
    }

    if (recommendedAt < earliest) {
      recommendedAt = getNextDateForHour(earliest, hour, contact.timezone ?? undefined);
    }
  }

  if (throttled) {
    rationale = `${rationale} • throttled 24h cooldown`;
  }

  await prisma.optimizerDecision.create({
    data: {
      contactId: contact.id,
      recommendedHour: hour,
      score,
      baselineScore: baseline,
      rationale: {
        segment: segment ?? "global",
        usedContactHistogram: Boolean(contactHistogram),
        usedSegmentHistogram: Boolean(segmentHistogram && segmentHistogram.sends.some((value) => value > 0)),
        generatedAt: referenceDate.toISOString(),
        throttled,
        recommendedAt: recommendedAt ? recommendedAt.toISOString() : null
      }
    }
  });

  return {
    recommendedHour: hour,
    recommendedAt,
    score,
    baselineScore: baseline,
    reason: rationale,
    throttled
  };
}

export function resetOptimizerCache() {
  histogramCache = null;
}

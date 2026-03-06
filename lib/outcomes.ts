import { ContactStatus, MessageStatus, Prisma, WorkspaceMode } from "@prisma/client";
import { prisma } from "./prisma";
import { resolveEmailEngineAdapter } from "./engines/adapter";

export type OutcomeType = "delivered" | "bounced" | "failed" | "complained" | "suppressed";

const OUTCOME_TAG_PREFIX = "outcome=";
const MAX_MINUTES_AFTER_SEND = 7 * 24 * 60;
const SYNTHETIC_FALLBACK_GRACE_MINUTES = 0;

export function mapProviderLastEventToOutcome(lastEvent: string | undefined): OutcomeType | null {
  if (!lastEvent) {
    return null;
  }

  const normalized = lastEvent.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("complain") || normalized.includes("spam")) {
    return "complained";
  }

  if (normalized.includes("suppress")) {
    return "suppressed";
  }

  if (normalized.includes("bounce")) {
    return "bounced";
  }

  if (normalized.includes("fail") || normalized.includes("reject") || normalized.includes("cancel")) {
    return "failed";
  }

  if (normalized.includes("deliver")) {
    return "delivered";
  }

  return null;
}

export type MessagePollingCandidate = {
  id: string;
  contactId: string;
  resendMessageId: string | null;
  sentAt: Date | null;
  broadcast: {
    sendMode: WorkspaceMode;
  } | null;
  contact: {
    id: string;
    email: string;
    tags: string[];
    status: ContactStatus;
    lifecycleStage: string | null;
    propensity: Prisma.Decimal | null;
  };
};

export type OutcomeSummary = {
  totalChecked: number;
  delivered: number;
  bounced: number;
  failed: number;
  complained: number;
  suppressed: number;
  unchanged: number;
};

const DEFAULT_SUMMARY: OutcomeSummary = {
  totalChecked: 0,
  delivered: 0,
  bounced: 0,
  failed: 0,
  complained: 0,
  suppressed: 0,
  unchanged: 0
};

export function inferOutcomeFromTags(tags: string[]): OutcomeType {
  const tag = tags.find((value) => value.startsWith(OUTCOME_TAG_PREFIX));
  if (!tag) {
    return "delivered";
  }

  const outcome = tag.split("=")[1];
  if (outcome === "bounced") {
    return "bounced";
  }
  if (outcome === "suppressed") {
    return "suppressed";
  }
  if (outcome === "complained") {
    return "complained";
  }
  if (outcome === "failed") {
    return "failed";
  }

  return "delivered";
}

export function determineOutcome(contact: { tags: string[]; status: ContactStatus }): OutcomeType {
  if (contact.status === ContactStatus.SUPPRESSED) {
    return "suppressed";
  }
  if (contact.status === ContactStatus.COMPLAINED) {
    return "complained";
  }
  if (contact.status === ContactStatus.BOUNCED) {
    return "bounced";
  }
  return inferOutcomeFromTags(contact.tags ?? []);
}

function messageStatusForOutcome(outcome: OutcomeType): MessageStatus {
  if (outcome === "delivered") {
    return MessageStatus.SENT;
  }
  if (outcome === "suppressed") {
    return MessageStatus.FAILED;
  }
  if (outcome === "complained") {
    return MessageStatus.FAILED;
  }
  if (outcome === "failed") {
    return MessageStatus.FAILED;
  }
  return MessageStatus.FAILED;
}

function extractNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (value && typeof value === "object" && "toString" in (value as Record<string, unknown>)) {
    const asString = (value as { toString(): string }).toString();
    const parsed = Number(asString);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stringHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function segmentFactor(lifecycleStage: string | null): number {
  if (lifecycleStage === "trial") {
    return 1.2;
  }
  if (lifecycleStage === "inactive") {
    return 0.6;
  }
  return 1.0;
}

function timeFactor(sentAt: Date): number {
  const hour = sentAt.getUTCHours();
  if (hour >= 13 && hour <= 17) {
    return 1.15;
  }
  if (hour >= 8 && hour <= 20) {
    return 1.0;
  }
  return 0.75;
}

type SyntheticClickDetails = {
  probability: number;
  baselineProbability: number;
  clickedAt: Date | null;
  clickProbability: Prisma.Decimal;
};

function buildSyntheticClickDetails(message: MessagePollingCandidate): SyntheticClickDetails {
  const basePropensity = clamp(extractNumber(message.contact.propensity) ?? 0.35, 0.01, 0.95);
  const segFactor = segmentFactor(message.contact.lifecycleStage);
  const sentAt = message.sentAt ?? new Date();
  const adaptiveTimeFactor = timeFactor(sentAt);
  const baselineTimeFactor = 0.9;

  const probability = clamp(basePropensity * segFactor * adaptiveTimeFactor, 0.01, 0.95);
  const baselineProbability = clamp(basePropensity * segFactor * baselineTimeFactor, 0.01, 0.95);

  const rng = createDeterministicRng(stringHash(`${message.id}:${message.contact.email}`));
  const clicked = rng() < probability;
  const minuteOffset = 5 + Math.floor(rng() * 175);
  const clickedAt = clicked ? new Date(sentAt.getTime() + minuteOffset * 60 * 1000) : null;

  return {
    probability,
    baselineProbability,
    clickedAt,
    clickProbability: new Prisma.Decimal(probability.toFixed(4))
  };
}

function isSandboxCandidate(message: MessagePollingCandidate): boolean {
  if (message.broadcast?.sendMode === WorkspaceMode.TEST) {
    return true;
  }

  const email = message.contact.email.toLowerCase();
  if (email.endsWith("@resend.dev")) {
    return true;
  }

  return message.contact.tags.some((tag) =>
    tag === "synthetic" ||
    tag === "test-list" ||
    tag.startsWith("segment=") ||
    tag.startsWith(OUTCOME_TAG_PREFIX)
  );
}

function applyOutcomeTimestamps(
  outcome: OutcomeType,
  syntheticDetails?: SyntheticClickDetails
): Prisma.MessageOutcomeUncheckedCreateInput {
  const now = new Date();
  const timestamps: Prisma.MessageOutcomeUncheckedCreateInput = {
    messageId: "",
    deliveredAt: null,
    bouncedAt: null,
    failedAt: null,
    complainedAt: null,
    suppressedAt: null,
    clickProbability: syntheticDetails?.clickProbability ?? null,
    clickedAt: syntheticDetails?.clickedAt ?? null,
    lastEvent: outcome,
    metadata: syntheticDetails
      ? {
          expected: outcome,
          synthetic: true,
          probability: syntheticDetails.probability,
          baselineProbability: syntheticDetails.baselineProbability
        }
      : { expected: outcome }
  };

  if (outcome === "delivered") {
    timestamps.deliveredAt = now;
  } else if (outcome === "bounced") {
    timestamps.bouncedAt = now;
  } else if (outcome === "suppressed") {
    timestamps.suppressedAt = now;
  } else if (outcome === "complained") {
    timestamps.complainedAt = now;
  } else if (outcome === "failed") {
    timestamps.failedAt = now;
  }

  return timestamps;
}

function mergeOutcomeCreate(messageId: string, base: Prisma.MessageOutcomeUncheckedCreateInput): Prisma.MessageOutcomeUncheckedCreateInput {
  return {
    ...base,
    messageId
  };
}

function shouldSkipMessage(message: MessagePollingCandidate): boolean {
  if (!message.sentAt) {
    return true;
  }
  const minutesSinceSend = (Date.now() - message.sentAt.getTime()) / 60000;
  return minutesSinceSend > MAX_MINUTES_AFTER_SEND;
}

export async function pollPendingMessages(batchSize = 100): Promise<OutcomeSummary> {
  const emailEngine = resolveEmailEngineAdapter();

  const candidates = await prisma.message.findMany({
    where: {
      resendMessageId: {
        not: null
      },
      status: {
        in: [MessageStatus.SENT, MessageStatus.PENDING]
      },
      outcome: {
        is: null
      }
    },
    orderBy: [
      { sentAt: "asc" },
      { createdAt: "asc" }
    ],
    take: batchSize,
    include: {
      broadcast: {
        select: {
          sendMode: true
        }
      },
      contact: {
        select: {
          id: true,
          email: true,
          tags: true,
          status: true,
          lifecycleStage: true,
          propensity: true
        }
      }
    }
  });

  if (candidates.length === 0) {
    return DEFAULT_SUMMARY;
  }

  let summary = { ...DEFAULT_SUMMARY };

  for (const message of candidates) {
    if (shouldSkipMessage(message)) {
      summary.unchanged += 1;
      continue;
    }

    let outcome: OutcomeType | null = null;
    const sandboxCandidate = isSandboxCandidate(message);
    const sentMinutesAgo = message.sentAt ? (Date.now() - message.sentAt.getTime()) / 60000 : Infinity;

    if (message.resendMessageId) {
      try {
        const providerStatus = await emailEngine.retrieveEmailStatus(message.resendMessageId);
        if (providerStatus.success) {
          outcome = mapProviderLastEventToOutcome(providerStatus.lastEvent);

          // Non-terminal provider events should not mutate outcome rows.
          if (!outcome) {
            // Sandbox traffic uses deterministic synthetic outcomes once a brief grace period has passed.
            if (sandboxCandidate && sentMinutesAgo >= SYNTHETIC_FALLBACK_GRACE_MINUTES) {
              outcome = determineOutcome(message.contact);
            } else {
              summary.unchanged += 1;
              await prisma.message.update({
                where: { id: message.id },
                data: {
                  lastStatusCheckAt: new Date()
                }
              });
              continue;
            }
          }
        }
      } catch (error) {
        // Fall through to synthetic fallback mode.
      }
    }

    if (!outcome) {
      outcome = determineOutcome(message.contact);
    }

    const updateStatus = messageStatusForOutcome(outcome);
    const existing = await prisma.messageOutcome.findUnique({ where: { messageId: message.id } });

    if (existing && existing.lastEvent === outcome) {
      summary.unchanged += 1;
      await prisma.message.update({
        where: { id: message.id },
        data: {
          lastStatusCheckAt: new Date()
        }
      });
      continue;
    }

    const syntheticDetails = sandboxCandidate && outcome === "delivered"
      ? buildSyntheticClickDetails(message)
      : undefined;
    const createPayload = mergeOutcomeCreate(message.id, applyOutcomeTimestamps(outcome, syntheticDetails));

    if (existing) {
      await prisma.messageOutcome.update({
        where: { messageId: message.id },
        data: {
          deliveredAt: createPayload.deliveredAt,
          bouncedAt: createPayload.bouncedAt,
          failedAt: createPayload.failedAt,
          complainedAt: createPayload.complainedAt,
          suppressedAt: createPayload.suppressedAt,
          clickProbability: createPayload.clickProbability,
          clickedAt: createPayload.clickedAt,
          lastEvent: createPayload.lastEvent,
          metadata: createPayload.metadata
        }
      });
    } else {
      await prisma.messageOutcome.create({
        data: createPayload
      });
    }

    await prisma.message.update({
      where: { id: message.id },
      data: {
        status: updateStatus,
        lastStatusCheckAt: new Date()
      }
    });

    summary = {
      ...summary,
      totalChecked: summary.totalChecked + 1,
      delivered: summary.delivered + (outcome === "delivered" ? 1 : 0),
      bounced: summary.bounced + (outcome === "bounced" ? 1 : 0),
      failed: summary.failed + (outcome === "failed" ? 1 : 0),
      complained: summary.complained + (outcome === "complained" ? 1 : 0),
      suppressed: summary.suppressed + (outcome === "suppressed" ? 1 : 0)
    };
  }

  return summary;
}

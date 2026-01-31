import { ContactStatus, MessageStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type OutcomeType = "delivered" | "bounced" | "failed" | "complained" | "suppressed";

const OUTCOME_TAG_PREFIX = "outcome=";
const MAX_MINUTES_AFTER_SEND = 120;

export type MessagePollingCandidate = {
  id: string;
  contactId: string;
  resendMessageId: string | null;
  sentAt: Date | null;
  contact: {
    id: string;
    tags: string[];
    status: ContactStatus;
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

function applyOutcomeTimestamps(outcome: OutcomeType): Prisma.MessageOutcomeUncheckedCreateInput {
  const now = new Date();
  const timestamps: Prisma.MessageOutcomeUncheckedCreateInput = {
    messageId: "",
    deliveredAt: null,
    bouncedAt: null,
    failedAt: null,
    complainedAt: null,
    suppressedAt: null,
    clickProbability: null,
    clickedAt: null,
    lastEvent: outcome,
    metadata: { expected: outcome }
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
  const candidates = await prisma.message.findMany({
    where: {
      resendMessageId: {
        not: null
      },
      status: {
        in: [MessageStatus.SENT, MessageStatus.PENDING]
      }
    },
    take: batchSize,
    include: {
      contact: {
        select: {
          id: true,
          tags: true,
          status: true
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

    const outcome = determineOutcome(message.contact);
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

    const createPayload = mergeOutcomeCreate(message.id, applyOutcomeTimestamps(outcome));

    if (existing) {
      await prisma.messageOutcome.update({
        where: { messageId: message.id },
        data: {
          deliveredAt: createPayload.deliveredAt,
          bouncedAt: createPayload.bouncedAt,
          failedAt: createPayload.failedAt,
          complainedAt: createPayload.complainedAt,
          suppressedAt: createPayload.suppressedAt,
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

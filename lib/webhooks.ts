import { MessageStatus, ContactStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type ResendWebhookEvent = {
  type?: string;
  data?: Record<string, unknown>;
};

export type WebhookProcessResult = {
  handled: boolean;
  messageId?: string;
  outcome?: string;
  reason?: string;
};

type OutcomeType = "delivered" | "bounced" | "failed" | "complained" | "suppressed";

function extractMessageId(data: Record<string, unknown> | undefined): string | null {
  if (!data) {
    return null;
  }
  const candidates = [
    data.id,
    data.message_id,
    data.email_id,
    data.resend_id
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function mapEventType(type: string | undefined): OutcomeType | null {
  if (!type) {
    return null;
  }
  const normalized = type.toLowerCase();
  if (normalized.includes("delivered")) {
    return "delivered";
  }
  if (normalized.includes("bounced")) {
    return "bounced";
  }
  if (normalized.includes("complaint") || normalized.includes("complained")) {
    return "complained";
  }
  if (normalized.includes("suppressed")) {
    return "suppressed";
  }
  if (normalized.includes("failed")) {
    return "failed";
  }
  return null;
}

function outcomeToMessageStatus(outcome: OutcomeType): MessageStatus {
  return outcome === "delivered" ? MessageStatus.SENT : MessageStatus.FAILED;
}

function buildOutcomeUpdate(outcome: OutcomeType): Prisma.MessageOutcomeUncheckedCreateInput {
  const now = new Date();
  return {
    messageId: "",
    deliveredAt: outcome === "delivered" ? now : null,
    bouncedAt: outcome === "bounced" ? now : null,
    failedAt: outcome === "failed" ? now : null,
    complainedAt: outcome === "complained" ? now : null,
    suppressedAt: outcome === "suppressed" ? now : null,
    clickProbability: null,
    clickedAt: null,
    lastEvent: outcome,
    metadata: { source: "webhook" }
  };
}

async function ensureSuppression(contactId: string, reason: string, source: string) {
  const existing = await prisma.suppression.findFirst({
    where: {
      contactId,
      reason,
      source
    }
  });
  if (existing) {
    return;
  }

  await prisma.suppression.create({
    data: {
      contactId,
      reason,
      source
    }
  });
}

export async function processResendWebhook(event: ResendWebhookEvent): Promise<WebhookProcessResult> {
  const outcome = mapEventType(event.type);
  const messageId = extractMessageId(event.data);

  if (!messageId) {
    return { handled: false, reason: "Missing message id" };
  }

  if (!outcome) {
    return { handled: false, messageId, reason: "Unrecognized event type" };
  }

  const message = await prisma.message.findFirst({
    where: { resendMessageId: messageId },
    include: { contact: true }
  });

  if (!message) {
    return { handled: false, messageId, outcome, reason: "Message not found" };
  }

  const existingOutcome = await prisma.messageOutcome.findUnique({ where: { messageId: message.id } });
  if (existingOutcome?.lastEvent === outcome) {
    return { handled: true, messageId: message.id, outcome };
  }

  const updatePayload = buildOutcomeUpdate(outcome);

  if (existingOutcome) {
    await prisma.messageOutcome.update({
      where: { messageId: message.id },
      data: {
        deliveredAt: updatePayload.deliveredAt,
        bouncedAt: updatePayload.bouncedAt,
        failedAt: updatePayload.failedAt,
        complainedAt: updatePayload.complainedAt,
        suppressedAt: updatePayload.suppressedAt,
        lastEvent: updatePayload.lastEvent,
        metadata: updatePayload.metadata
      }
    });
  } else {
    await prisma.messageOutcome.create({
      data: {
        ...updatePayload,
        messageId: message.id
      }
    });
  }

  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: outcomeToMessageStatus(outcome),
      lastStatusCheckAt: new Date()
    }
  });

  if (message.contactId && outcome !== "delivered") {
    let nextStatus: ContactStatus | null = null;
    if (outcome === "bounced") {
      nextStatus = ContactStatus.BOUNCED;
    } else if (outcome === "complained") {
      nextStatus = ContactStatus.COMPLAINED;
    } else if (outcome === "suppressed") {
      nextStatus = ContactStatus.SUPPRESSED;
    }

    if (nextStatus) {
      await prisma.contact.update({
        where: { id: message.contactId },
        data: { status: nextStatus }
      });

      if (outcome === "bounced" || outcome === "suppressed") {
        await ensureSuppression(message.contactId, outcome, "webhook");
      }
    }
  }

  return { handled: true, messageId: message.id, outcome };
}

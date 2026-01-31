import { BroadcastStatus, ContactStatus, MessageStatus, Prisma, WorkspaceMode } from "@prisma/client";
import { prisma } from "./prisma";
import { ResendError, sendResendEmail } from "./resend";
import { recommendSendTime } from "./optimizer";

const ALL_CONTACTS_SEGMENT_NAME = "All Contacts";
const ALL_CONTACTS_SEGMENT_DEFINITION = { type: "all" } as const;
const SCHEDULE_THRESHOLD_MS = 5 * 60 * 1000;

export const SEND_EXCLUDED_STATUSES = new Set<ContactStatus>([
  ContactStatus.SUPPRESSED,
  ContactStatus.COMPLAINED
]);

export type ContactSnapshot = {
  id: string;
  email: string | null;
  status: ContactStatus;
  tags: string[];
};

export type ContactPartition = {
  sendable: ContactSnapshot[];
  skipped: ContactSnapshot[];
};

export function partitionContactsByEligibility(contacts: ContactSnapshot[]): ContactPartition {
  return contacts.reduce<ContactPartition>(
    (acc, contact) => {
      if (!contact.email || SEND_EXCLUDED_STATUSES.has(contact.status)) {
        acc.skipped.push(contact);
      } else {
        acc.sendable.push(contact);
      }
      return acc;
    },
    { sendable: [], skipped: [] }
  );
}

export function buildTagRecord(tags: string[]): Record<string, string> | undefined {
  if (!tags.length) {
    return undefined;
  }

  const entries: Record<string, string> = {};
  tags.slice(0, 8).forEach((tag, index) => {
    entries[`tag_${index + 1}`] = tag;
  });
  return entries;
}

export async function ensureAllContactsSegmentId(): Promise<string> {
  const existing = await prisma.segment.findFirst({ where: { name: ALL_CONTACTS_SEGMENT_NAME } });
  if (existing) {
    return existing.id;
  }

  const created = await prisma.segment.create({
    data: {
      name: ALL_CONTACTS_SEGMENT_NAME,
      description: "System segment containing every active contact",
      definition: ALL_CONTACTS_SEGMENT_DEFINITION,
      isSystem: true
    }
  });
  return created.id;
}

async function resolveTemplateId(templateId?: string | null): Promise<string> {
  if (templateId) {
    const template = await prisma.template.findUnique({ where: { id: templateId } });
    if (!template) {
      throw new Error("Template not found");
    }
    return template.id;
  }

  const fallback = await prisma.template.findFirst({ orderBy: { createdAt: "asc" } });
  if (!fallback) {
    throw new Error("No templates are available");
  }
  return fallback.id;
}

export type BroadcastDraftInput = {
  name: string;
  templateId?: string | null;
  segmentId?: string | null;
  sendMode?: WorkspaceMode;
};

export async function createBroadcastDraft(input: BroadcastDraftInput) {
  if (!input.name.trim()) {
    throw new Error("Broadcast name is required");
  }

  const [templateId, segmentId] = await Promise.all([
    resolveTemplateId(input.templateId ?? null),
    (async () => {
      if (input.segmentId) {
        const segment = await prisma.segment.findUnique({ where: { id: input.segmentId } });
        if (!segment) {
          throw new Error("Segment not found");
        }
        return segment.id;
      }
      return ensureAllContactsSegmentId();
    })()
  ]);

  return prisma.broadcast.create({
    data: {
      name: input.name,
      status: BroadcastStatus.DRAFT,
      templateId,
      segmentId,
      sendMode: input.sendMode ?? WorkspaceMode.TEST
    }
  });
}

export type BroadcastSendOptions = {
  useOptimizer?: boolean;
};

export type OptimizerSendSummary = {
  evaluated: number;
  scheduled: number;
  sentImmediately: number;
  throttled: number;
  skipped: number;
  reasons: Record<string, number>;
};

export type BroadcastSendSummary = {
  broadcastId: string;
  totalRecipients: number;
  skippedRecipients: number;
  scheduledRecipients: number;
  alreadySent: boolean;
  durationMs: number;
  messageIds: string[];
  optimizerSummary: OptimizerSendSummary;
};

function createEmptyOptimizerSummary(): OptimizerSendSummary {
  return {
    evaluated: 0,
    scheduled: 0,
    sentImmediately: 0,
    throttled: 0,
    skipped: 0,
    reasons: {}
  };
}

export async function sendBroadcastById(broadcastId: string, options?: BroadcastSendOptions): Promise<BroadcastSendSummary> {
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
    include: {
      template: true
    }
  });

  if (!broadcast) {
    throw new Error("Broadcast not found");
  }

  if (!broadcast.template) {
    throw new Error("Broadcast template is missing");
  }

  if (broadcast.status === BroadcastStatus.SENT) {
    const existingCount = await prisma.message.count({ where: { broadcastId } });
    return {
      broadcastId,
      totalRecipients: existingCount,
      skippedRecipients: 0,
      scheduledRecipients: 0,
      alreadySent: true,
      durationMs: 0,
      messageIds: [],
      optimizerSummary: createEmptyOptimizerSummary()
    };
  }

  const existingMessages = await prisma.message.count({ where: { broadcastId } });
  if (existingMessages > 0) {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: BroadcastStatus.SENT, totalRecipients: existingMessages }
    });
    return {
      broadcastId,
      totalRecipients: existingMessages,
      skippedRecipients: 0,
      scheduledRecipients: 0,
      alreadySent: true,
      durationMs: 0,
      messageIds: [],
      optimizerSummary: createEmptyOptimizerSummary()
    };
  }

  const contactSnapshots = await prisma.contact.findMany({
    select: {
      id: true,
      email: true,
      status: true,
      tags: true
    },
    orderBy: { email: "asc" }
  });

  const { sendable, skipped } = partitionContactsByEligibility(contactSnapshots);

  if (sendable.length === 0) {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        status: BroadcastStatus.SENT,
        totalRecipients: 0
      }
    });

    return {
      broadcastId,
      totalRecipients: 0,
      skippedRecipients: skipped.length,
      scheduledRecipients: 0,
      alreadySent: false,
      durationMs: 0,
      messageIds: [],
      optimizerSummary: createEmptyOptimizerSummary()
    };
  }

  const startedAt = Date.now();
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: BroadcastStatus.SENDING }
  });

  const messageRows: Prisma.MessageCreateManyInput[] = [];
  const messageIds: string[] = [];
  let scheduledCount = 0;
  let optimizerSkipped = 0;
  const optimizerSummary = createEmptyOptimizerSummary();

  try {
    for (const contact of sendable) {
      let recommendedAt: Date | null = null;
      let recommendationReason: string | null = null;
      let throttled = false;

      if (options?.useOptimizer !== false) {
        try {
          const recommendation = await recommendSendTime(contact.id);
          optimizerSummary.evaluated += 1;
          recommendationReason = recommendation.reason;
          if (recommendationReason) {
            optimizerSummary.reasons[recommendationReason] = (optimizerSummary.reasons[recommendationReason] ?? 0) + 1;
          }
          throttled = recommendation.throttled;
          recommendedAt = recommendation.recommendedAt;
        } catch (error) {
          console.warn("Optimizer recommendation failed", error);
        }
      }

      if (throttled) {
        optimizerSummary.throttled += 1;
      }

      if (recommendedAt && recommendedAt.getTime() > Date.now() + SCHEDULE_THRESHOLD_MS) {
        scheduledCount += 1;
        optimizerSummary.scheduled += 1;
        messageRows.push({
          broadcastId,
          contactId: contact.id,
          templateId: broadcast.templateId,
          resendMessageId: null,
          status: MessageStatus.SCHEDULED,
          scheduledSendAt: recommendedAt,
          lastStatusCheckAt: null
        });
        continue;
      }

      if (options?.useOptimizer !== false && recommendationReason && !recommendedAt) {
        optimizerSkipped += 1;
        optimizerSummary.skipped += 1;
        continue;
      }

      const sendResult = await sendResendEmail({
        to: contact.email as string,
        subject: broadcast.template.subject,
        html: broadcast.template.html,
        tags: buildTagRecord(contact.tags)
      });

      const sentAt = new Date();
      messageIds.push(sendResult.id);
      optimizerSummary.sentImmediately += 1;
      messageRows.push({
        broadcastId,
        contactId: contact.id,
        templateId: broadcast.templateId,
        resendMessageId: sendResult.id,
        status: MessageStatus.SENT,
        scheduledSendAt: recommendedAt ?? undefined,
        sentAt,
        lastStatusCheckAt: null
      });
    }
  } catch (error) {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: BroadcastStatus.DRAFT }
    });

    throw error;
  }

  if (messageRows.length === 0) {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        status: BroadcastStatus.SENT,
        totalRecipients: 0
      }
    });

    const duration = Date.now() - startedAt;

    return {
      broadcastId,
      totalRecipients: 0,
      skippedRecipients: skipped.length + optimizerSkipped,
      scheduledRecipients: 0,
      alreadySent: false,
      durationMs: duration,
      messageIds,
      optimizerSummary
    };
  }

  const contactUpdates = messageRows
    .filter((row) => Boolean(row.sentAt))
    .map((row) =>
      prisma.contact.update({
        where: { id: row.contactId },
        data: { lastMessageSentAt: row.sentAt as Date }
      })
    );

  const nextStatus = scheduledCount === 0
    ? BroadcastStatus.SENT
    : scheduledCount === messageRows.length
      ? BroadcastStatus.SCHEDULED
      : BroadcastStatus.SENDING;

  await prisma.$transaction([
    prisma.message.createMany({ data: messageRows }),
    prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        status: nextStatus,
        totalRecipients: messageRows.length
      }
    }),
    ...contactUpdates
  ]);

  const durationMs = Date.now() - startedAt;

  return {
    broadcastId,
    totalRecipients: messageRows.length,
    skippedRecipients: skipped.length + optimizerSkipped,
    scheduledRecipients: scheduledCount,
    alreadySent: false,
    durationMs,
    messageIds,
    optimizerSummary
  };
}

export function formatBroadcastSummary(summary: BroadcastSendSummary): string {
  if (summary.alreadySent) {
    return `Broadcast ${summary.broadcastId} was already processed`;
  }

  const immediate = summary.optimizerSummary.sentImmediately;
  const scheduled = summary.scheduledRecipients;
  const evaluated = summary.optimizerSummary.evaluated;
  const skipped = summary.skippedRecipients;

  const parts: string[] = [];
  if (immediate > 0) {
    parts.push(`${immediate} sent now`);
  }
  if (scheduled > 0) {
    parts.push(`${scheduled} scheduled`);
  }
  if (skipped > 0) {
    parts.push(`${skipped} skipped`);
  }
  if (evaluated > 0) {
    parts.push(`optimizer evaluated ${evaluated}`);
  }

  if (!parts.length) {
    return "Broadcast processed with no eligible recipients";
  }

  return `Broadcast processed: ${parts.join(", ")}`;
}

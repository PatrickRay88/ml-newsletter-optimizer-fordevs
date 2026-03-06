import { BroadcastStatus, ContactStatus, MessageStatus, Prisma, WorkspaceMode } from "@prisma/client";
import { prisma } from "./prisma";
import { ResendError } from "./resend";
import { resolveEmailEngineAdapter } from "./engines/adapter";
import type { EmailEngineAdapter } from "./engines/adapter";
import { recommendSendTime } from "./optimizer";

const ALL_CONTACTS_SEGMENT_NAME = "All Contacts";
const ALL_CONTACTS_SEGMENT_DEFINITION = { type: "all" } as const;
const SCHEDULE_THRESHOLD_MS = 5 * 60 * 1000;
const BULK_SEND_CHUNK_SIZE = 100;

export const SEND_EXCLUDED_STATUSES = new Set<ContactStatus>([
  ContactStatus.SUPPRESSED,
  ContactStatus.COMPLAINED,
  ContactStatus.BOUNCED
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
  let index = 1;

  for (const tag of tags) {
    if (index > 8) {
      break;
    }

    const sanitized = sanitizeOutgoingTag(tag);
    if (!sanitized) {
      continue;
    }

    entries[`tag_${index}`] = sanitized;
    index += 1;
  }

  if (Object.keys(entries).length === 0) {
    return undefined;
  }

  return entries;
}

function sanitizeOutgoingTag(tag: string): string | null {
  const ascii = tag.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  const normalized = ascii
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 64);
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
  sendStrategy?: BroadcastSendStrategy;
};

export type BroadcastSendStrategy = "individual" | "bulk";

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
  sendStrategy: BroadcastSendStrategy;
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

type ImmediateRecipient = {
  contact: ContactSnapshot;
  recommendedAt: Date | null;
};

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function createFallbackMessageId(contactId: string, chunkIndex: number, itemIndex: number): string {
  return `bulk-${Date.now()}-${chunkIndex}-${itemIndex}-${contactId}`;
}

async function sendImmediateRecipientsIndividually(params: {
  emailEngine: EmailEngineAdapter;
  recipients: ImmediateRecipient[];
  subject: string;
  html: string;
  broadcastId: string;
  templateId: string;
}): Promise<{ messageRows: Prisma.MessageCreateManyInput[]; messageIds: string[] }> {
  const messageRows: Prisma.MessageCreateManyInput[] = [];
  const messageIds: string[] = [];

  for (const recipient of params.recipients) {
    const sendResult = await params.emailEngine.sendEmail({
      to: recipient.contact.email as string,
      subject: params.subject,
      html: params.html,
      tags: buildTagRecord(recipient.contact.tags)
    });

    const sentAt = new Date();
    messageIds.push(sendResult.messageId);
    messageRows.push({
      broadcastId: params.broadcastId,
      contactId: recipient.contact.id,
      templateId: params.templateId,
      resendMessageId: sendResult.messageId,
      status: MessageStatus.SENT,
      scheduledSendAt: recipient.recommendedAt ?? undefined,
      sentAt,
      lastStatusCheckAt: null
    });
  }

  return { messageRows, messageIds };
}

async function sendImmediateRecipientsBulk(params: {
  emailEngine: EmailEngineAdapter;
  recipients: ImmediateRecipient[];
  subject: string;
  html: string;
  broadcastId: string;
  templateId: string;
}): Promise<{ messageRows: Prisma.MessageCreateManyInput[]; messageIds: string[] }> {
  if (!params.emailEngine.sendEmailBatch) {
    return sendImmediateRecipientsIndividually(params);
  }

  const messageRows: Prisma.MessageCreateManyInput[] = [];
  const messageIds: string[] = [];
  const recipientChunks = chunk(params.recipients, BULK_SEND_CHUNK_SIZE);

  for (let chunkIndex = 0; chunkIndex < recipientChunks.length; chunkIndex += 1) {
    const recipientChunk = recipientChunks[chunkIndex];

    try {
      const batchResult = await params.emailEngine.sendEmailBatch({
        messages: recipientChunk.map((recipient) => ({
          to: recipient.contact.email as string,
          subject: params.subject,
          html: params.html,
          tags: buildTagRecord(recipient.contact.tags)
        }))
      });

      recipientChunk.forEach((recipient, itemIndex) => {
        const messageId = batchResult.messageIds[itemIndex] ?? createFallbackMessageId(recipient.contact.id, chunkIndex, itemIndex);
        const sentAt = new Date();
        messageIds.push(messageId);
        messageRows.push({
          broadcastId: params.broadcastId,
          contactId: recipient.contact.id,
          templateId: params.templateId,
          resendMessageId: messageId,
          status: MessageStatus.SENT,
          scheduledSendAt: recipient.recommendedAt ?? undefined,
          sentAt,
          lastStatusCheckAt: null
        });
      });
    } catch {
      // If provider bulk send fails, degrade gracefully to individual sends for this chunk.
      const fallback = await sendImmediateRecipientsIndividually({
        ...params,
        recipients: recipientChunk
      });
      messageRows.push(...fallback.messageRows);
      messageIds.push(...fallback.messageIds);
    }
  }

  return { messageRows, messageIds };
}

export async function sendBroadcastById(broadcastId: string, options?: BroadcastSendOptions): Promise<BroadcastSendSummary> {
  const emailEngine = resolveEmailEngineAdapter();
  const sendStrategy: BroadcastSendStrategy = options?.sendStrategy ?? "individual";

  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
    include: {
      template: true,
      segment: {
        select: {
          id: true,
          isSystem: true
        }
      }
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
      sendStrategy,
      alreadySent: true,
      durationMs: 0,
      messageIds: [],
      optimizerSummary: createEmptyOptimizerSummary()
    };
  }

  const existingMessages = await prisma.message.count({ where: { broadcastId } });
  if (existingMessages > 0) {
    return {
      broadcastId,
      totalRecipients: existingMessages,
      skippedRecipients: 0,
      scheduledRecipients: 0,
      sendStrategy,
      alreadySent: true,
      durationMs: 0,
      messageIds: [],
      optimizerSummary: createEmptyOptimizerSummary()
    };
  }

  const contactSnapshots = await prisma.contact.findMany({
    where:
      broadcast.segmentId && !broadcast.segment?.isSystem
        ? {
            segmentMemberships: {
              some: {
                segmentId: broadcast.segmentId
              }
            }
          }
        : undefined,
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
      sendStrategy,
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
  let messageIds: string[] = [];
  const immediateRecipients: ImmediateRecipient[] = [];
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

      immediateRecipients.push({
        contact,
        recommendedAt
      });
    }

    const immediateSendResult = sendStrategy === "bulk"
      ? await sendImmediateRecipientsBulk({
          emailEngine,
          recipients: immediateRecipients,
          subject: broadcast.template.subject,
          html: broadcast.template.html,
          broadcastId,
          templateId: broadcast.templateId
        })
      : await sendImmediateRecipientsIndividually({
          emailEngine,
          recipients: immediateRecipients,
          subject: broadcast.template.subject,
          html: broadcast.template.html,
          broadcastId,
          templateId: broadcast.templateId
        });

    messageRows.push(...immediateSendResult.messageRows);
    messageIds = immediateSendResult.messageIds;
    optimizerSummary.sentImmediately = immediateSendResult.messageRows.length;
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
      sendStrategy,
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
    sendStrategy,
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

  if (summary.sendStrategy === "bulk") {
    parts.push("bulk mode");
  }

  return `Broadcast processed: ${parts.join(", ")}`;
}

export type ScheduledDispatchSummary = {
  checked: number;
  sent: number;
  failed: number;
  skipped: number;
  updatedBroadcasts: number;
};

const EMPTY_SCHEDULED_DISPATCH_SUMMARY: ScheduledDispatchSummary = {
  checked: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  updatedBroadcasts: 0
};

export async function dispatchDueScheduledMessages(limit = 200): Promise<ScheduledDispatchSummary> {
  const now = new Date();
  const emailEngine = resolveEmailEngineAdapter();

  const dueMessages = await prisma.message.findMany({
    where: {
      status: MessageStatus.SCHEDULED,
      scheduledSendAt: {
        lte: now
      },
      resendMessageId: null
    },
    include: {
      contact: {
        select: {
          id: true,
          email: true,
          status: true,
          tags: true
        }
      },
      template: {
        select: {
          subject: true,
          html: true
        }
      }
    },
    orderBy: {
      scheduledSendAt: "asc"
    },
    take: limit
  });

  if (dueMessages.length === 0) {
    return EMPTY_SCHEDULED_DISPATCH_SUMMARY;
  }

  const summary: ScheduledDispatchSummary = {
    checked: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    updatedBroadcasts: 0
  };

  const touchedBroadcastIds = new Set<string>();

  for (const message of dueMessages) {
    summary.checked += 1;

    if (message.broadcastId) {
      touchedBroadcastIds.add(message.broadcastId);
    }

    if (!message.contact.email || SEND_EXCLUDED_STATUSES.has(message.contact.status)) {
      summary.skipped += 1;
      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.FAILED,
          lastStatusCheckAt: now
        }
      });
      continue;
    }

    if (!message.template) {
      summary.failed += 1;
      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.FAILED,
          lastStatusCheckAt: now
        }
      });
      continue;
    }

    try {
      const sendResult = await emailEngine.sendEmail({
        to: message.contact.email,
        subject: message.template.subject,
        html: message.template.html,
        tags: buildTagRecord(message.contact.tags)
      });

      const sentAt = new Date();
      await prisma.$transaction([
        prisma.message.update({
          where: { id: message.id },
          data: {
            status: MessageStatus.SENT,
            sentAt,
            resendMessageId: sendResult.messageId,
            lastStatusCheckAt: null
          }
        }),
        prisma.contact.update({
          where: { id: message.contact.id },
          data: {
            lastMessageSentAt: sentAt
          }
        })
      ]);

      summary.sent += 1;
    } catch (error) {
      summary.failed += 1;
      await prisma.message.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.FAILED,
          lastStatusCheckAt: now
        }
      });
    }
  }

  for (const broadcastId of touchedBroadcastIds) {
    const [scheduledCount, sentCount, failedCount, totalCount] = await Promise.all([
      prisma.message.count({ where: { broadcastId, status: MessageStatus.SCHEDULED } }),
      prisma.message.count({ where: { broadcastId, status: MessageStatus.SENT } }),
      prisma.message.count({ where: { broadcastId, status: MessageStatus.FAILED } }),
      prisma.message.count({ where: { broadcastId } })
    ]);

    const nextStatus = scheduledCount === 0
      ? BroadcastStatus.SENT
      : sentCount > 0 || failedCount > 0
        ? BroadcastStatus.SENDING
        : BroadcastStatus.SCHEDULED;

    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: {
        status: nextStatus,
        totalRecipients: totalCount
      }
    });
  }

  summary.updatedBroadcasts = touchedBroadcastIds.size;
  return summary;
}

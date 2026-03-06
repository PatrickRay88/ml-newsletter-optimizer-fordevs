import { ContactStatus, MessageStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettingsSummary } from "@/lib/settings";
import BroadcastsClient, { type BroadcastSummary } from "./broadcasts-client";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  const [
    broadcasts,
    templates,
    segments,
    settings,
    totalSendableContacts,
    sendableMembershipCounts,
    latestStatusCheckAggregate,
    latestPollJobEvent,
    nextDueScheduledAggregate,
    scheduledQueueCount,
    unresolvedOutcomeCount
  ] = await Promise.all([
    prisma.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        segment: true,
        template: true,
        messages: {
          select: {
            status: true,
            scheduledSendAt: true,
            contact: {
              select: {
                email: true
              }
            },
            outcome: {
              select: {
                deliveredAt: true,
                bouncedAt: true,
                suppressedAt: true,
                clickedAt: true,
                metadata: true
              }
            }
          }
        }
      }
    }),
    prisma.template.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, subject: true }
    }),
    prisma.segment.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, isSystem: true }
    }),
    getSettingsSummary(),
    prisma.contact.count({
      where: {
        status: {
          notIn: [ContactStatus.SUPPRESSED, ContactStatus.COMPLAINED, ContactStatus.BOUNCED]
        }
      }
    }),
    prisma.segmentMembership.groupBy({
      by: ["segmentId"],
      where: {
        contact: {
          status: {
            notIn: [ContactStatus.SUPPRESSED, ContactStatus.COMPLAINED, ContactStatus.BOUNCED]
          }
        }
      },
      _count: {
        _all: true
      }
    }),
    prisma.message.aggregate({
      _max: {
        lastStatusCheckAt: true
      }
    }),
    prisma.event.findFirst({
      where: {
        eventName: "job:poll-email-status"
      },
      orderBy: {
        timestamp: "desc"
      },
      select: {
        timestamp: true
      }
    }),
    prisma.message.aggregate({
      where: {
        status: MessageStatus.SCHEDULED,
        scheduledSendAt: {
          not: null
        }
      },
      _min: {
        scheduledSendAt: true
      }
    }),
    prisma.message.count({
      where: {
        status: MessageStatus.SCHEDULED
      }
    }),
    prisma.message.count({
      where: {
        resendMessageId: { not: null },
        status: { in: [MessageStatus.SENT, MessageStatus.PENDING] },
        outcome: { is: null }
      }
    })
  ]);

  const lastRunAt = latestPollJobEvent?.timestamp ?? latestStatusCheckAggregate._max.lastStatusCheckAt;
  const schedulerState: "running" | "stale" | "idle" = !lastRunAt
    ? "idle"
    : Date.now() - lastRunAt.getTime() <= 5 * 60 * 1000
      ? "running"
      : "stale";

  const schedulerStatus = {
    state: schedulerState,
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    nextDueScheduledAt: nextDueScheduledAggregate._min.scheduledSendAt
      ? nextDueScheduledAggregate._min.scheduledSendAt.toISOString()
      : null,
    queuedScheduled: scheduledQueueCount,
    unresolvedOutcomes: unresolvedOutcomeCount
  };

  const segmentAudienceMap = new Map<string, number>(
    sendableMembershipCounts.map((row) => [row.segmentId, row._count._all])
  );

  const summary: BroadcastSummary[] = broadcasts.map((broadcast) => {
    const total = broadcast.messages.length;
    let delivered = 0;
    let bounced = 0;
    let suppressed = 0;
    let clicked = 0;
    let baselineProbabilitySum = 0;
    let baselineCount = 0;
    const scheduledWindowMap = new Map<string, { count: number; sampleEmails: string[] }>();

    broadcast.messages.forEach((message) => {
      if (message.outcome?.deliveredAt) {
        delivered += 1;
      }
      if (message.outcome?.bouncedAt) {
        bounced += 1;
      }
      if (message.outcome?.suppressedAt) {
        suppressed += 1;
      }
      if (message.outcome?.clickedAt) {
        clicked += 1;
      }

      if (message.status === "SCHEDULED" && message.scheduledSendAt) {
        const key = message.scheduledSendAt.toISOString();
        const bucket = scheduledWindowMap.get(key) ?? { count: 0, sampleEmails: [] };
        bucket.count += 1;
        if (message.contact?.email && bucket.sampleEmails.length < 5) {
          bucket.sampleEmails.push(message.contact.email);
        }
        scheduledWindowMap.set(key, bucket);
      }

      const metadata = message.outcome?.metadata;
      if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
        const baselineValue = (metadata as Record<string, unknown>).baselineProbability;
        if (typeof baselineValue === "number" && Number.isFinite(baselineValue)) {
          baselineProbabilitySum += baselineValue;
          baselineCount += 1;
        }
      }
    });

    const ctr = delivered > 0 ? clicked / delivered : 0;
    const baselineCtr = baselineCount > 0 ? baselineProbabilitySum / baselineCount : 0;
    const upliftPct = baselineCtr > 0 ? ((ctr - baselineCtr) / baselineCtr) * 100 : 0;
    const audienceSize = broadcast.segment?.isSystem
      ? totalSendableContacts
      : broadcast.segmentId
        ? (segmentAudienceMap.get(broadcast.segmentId) ?? 0)
        : totalSendableContacts;
    const scheduledPreview = Array.from(scheduledWindowMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 5)
      .map(([scheduledAt, details]) => ({
        scheduledAt,
        count: details.count,
        sampleEmails: details.sampleEmails
      }));
    const scheduledCount = Array.from(scheduledWindowMap.values()).reduce((sum, value) => sum + value.count, 0);

    return {
      id: broadcast.id,
      name: broadcast.name,
      status: broadcast.status,
      sendMode: broadcast.sendMode,
      scheduledSendAt: broadcast.scheduledSendAt?.toISOString() ?? null,
      createdAt: broadcast.createdAt.toISOString(),
      segment: broadcast.segment?.name ?? "All Contacts",
      template: broadcast.template?.name ?? "Template",
      audienceSize,
      scheduledCount,
      scheduledPreview,
      total,
      delivered,
      bounced,
      suppressed,
      clicked,
      ctr,
      baselineCtr,
      upliftPct
    };
  });

  return (
    <BroadcastsClient
      broadcasts={summary}
      templates={templates}
      segments={segments}
      defaultSendMode={settings.mode}
      schedulerStatus={schedulerStatus}
    />
  );
}

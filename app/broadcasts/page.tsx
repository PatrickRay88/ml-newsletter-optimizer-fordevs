import { prisma } from "@/lib/prisma";
import { getSettingsSummary } from "@/lib/settings";
import BroadcastsClient, { type BroadcastSummary } from "./broadcasts-client";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  const [broadcasts, templates, segments, settings] = await Promise.all([
    prisma.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        segment: true,
        template: true,
        messages: {
          select: {
            status: true,
            outcome: {
              select: {
                deliveredAt: true,
                bouncedAt: true,
                suppressedAt: true,
                clickedAt: true
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
    getSettingsSummary()
  ]);

  const summary: BroadcastSummary[] = broadcasts.map((broadcast) => {
    const total = broadcast.messages.length;
    let delivered = 0;
    let bounced = 0;
    let suppressed = 0;
    let clicked = 0;

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
    });

    const ctr = delivered > 0 ? clicked / delivered : 0;

    return {
      id: broadcast.id,
      name: broadcast.name,
      status: broadcast.status,
      sendMode: broadcast.sendMode,
      scheduledSendAt: broadcast.scheduledSendAt?.toISOString() ?? null,
      createdAt: broadcast.createdAt.toISOString(),
      segment: broadcast.segment?.name ?? "All Contacts",
      template: broadcast.template?.name ?? "Template",
      total,
      delivered,
      bounced,
      suppressed,
      clicked,
      ctr
    };
  });

  return (
    <BroadcastsClient
      broadcasts={summary}
      templates={templates}
      segments={segments}
      defaultSendMode={settings.mode}
    />
  );
}

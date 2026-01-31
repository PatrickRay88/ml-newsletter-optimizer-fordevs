import { prisma } from "@/lib/prisma";
import DeliverabilityClient from "./deliverability-client";

export const dynamic = "force-dynamic";

export default async function DeliverabilityPage() {
  const [delivered, bounced, failed, complained, suppressed, outcomesTotal, suppressionCount, statusCounts, contacts] =
    await Promise.all([
      prisma.messageOutcome.count({ where: { deliveredAt: { not: null } } }),
      prisma.messageOutcome.count({ where: { bouncedAt: { not: null } } }),
      prisma.messageOutcome.count({ where: { failedAt: { not: null } } }),
      prisma.messageOutcome.count({ where: { complainedAt: { not: null } } }),
      prisma.messageOutcome.count({ where: { suppressedAt: { not: null } } }),
      prisma.messageOutcome.count(),
      prisma.suppression.count(),
      prisma.contact.groupBy({
        by: ["status"],
        _count: { status: true }
      }),
      prisma.contact.findMany({ select: { email: true } })
    ]);

  const statusMap = statusCounts.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.status] = entry._count.status;
    return acc;
  }, {});

  const domainCounts = contacts.reduce<Record<string, number>>((acc, contact) => {
    const domain = contact.email.split("@")[1]?.toLowerCase() ?? "unknown";
    acc[domain] = (acc[domain] ?? 0) + 1;
    return acc;
  }, {});

  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return (
    <DeliverabilityClient
      delivered={delivered}
      bounced={bounced}
      failed={failed}
      complained={complained}
      suppressed={suppressed}
      outcomesTotal={outcomesTotal}
      suppressionCount={suppressionCount}
      statusMap={statusMap}
      topDomains={topDomains}
    />
  );
}

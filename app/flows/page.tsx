import { prisma } from "@/lib/prisma";
import { getFlowsOverview } from "@/lib/flows";
import FlowsClient from "./flows-client";

export const dynamic = "force-dynamic";

export default async function FlowsPage() {
  const [flows, templates, segments] = await Promise.all([
    getFlowsOverview(),
    prisma.template.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, subject: true }
    }),
    prisma.segment.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, isSystem: true }
    })
  ]);

  return <FlowsClient flows={flows} templates={templates} segments={segments} />;
}

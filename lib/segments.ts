import { ContactStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type SegmentFilterDefinition =
  | { type: "status"; value: ContactStatus }
  | { type: "tag"; value: string }
  | { type: "timezone"; value: string }
  | { type: "last_event_within_days"; value: number };

export type SegmentDefinition = {
  filters: SegmentFilterDefinition[];
};

export type SegmentInput = {
  name: string;
  description?: string | null;
  filters: SegmentFilterDefinition[];
};

export type SegmentHeatmapCell = {
  hour: number;
  sends: number;
  clicks: number;
  rate: number;
};

export type SegmentHeatmap = {
  segmentId: string;
  cells: SegmentHeatmapCell[];
  bestHour: number | null;
  bestRate: number;
};

function normalizeFilters(filters: SegmentFilterDefinition[]): SegmentFilterDefinition[] {
  const deduped: SegmentFilterDefinition[] = [];
  const seen = new Set<string>();

  filters.forEach((filter) => {
    const key = `${filter.type}:${"value" in filter ? String(filter.value) : ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(filter);
  });

  return deduped;
}

export function buildSegmentDefinition(filters: SegmentFilterDefinition[]): SegmentDefinition {
  return {
    filters: normalizeFilters(filters)
  };
}

export async function createSegment(input: SegmentInput) {
  if (!input.name.trim()) {
    throw new Error("Segment name is required");
  }

  const definition = buildSegmentDefinition(input.filters ?? []);

  return prisma.segment.create({
    data: {
      name: input.name.trim(),
      description: input.description ?? null,
      definition,
      isSystem: false
    }
  });
}

function matchesFilters(contact: {
  status: ContactStatus;
  tags: string[];
  timezone: string | null;
  lastEventAt: Date | null;
}, filters: SegmentFilterDefinition[]): boolean {
  return filters.every((filter) => {
    if (filter.type === "status") {
      return contact.status === filter.value;
    }
    if (filter.type === "tag") {
      return contact.tags.includes(filter.value);
    }
    if (filter.type === "timezone") {
      return contact.timezone === filter.value;
    }
    if (filter.type === "last_event_within_days") {
      if (!contact.lastEventAt) {
        return false;
      }
      const cutoff = Date.now() - filter.value * 24 * 60 * 60 * 1000;
      return contact.lastEventAt.getTime() >= cutoff;
    }
    return true;
  });
}

export async function recomputeSegmentMembership(segmentId: string): Promise<{ total: number }> {
  const segment = await prisma.segment.findUnique({ where: { id: segmentId } });
  if (!segment) {
    throw new Error("Segment not found");
  }

  const definition = segment.definition as SegmentDefinition | null;
  if (!definition) {
    throw new Error("Segment definition missing");
  }

  const contacts = await prisma.contact.findMany({
    select: {
      id: true,
      status: true,
      tags: true,
      timezone: true,
      lastEventAt: true
    }
  });

  const matches = definition.filters.length === 0
    ? contacts
    : contacts.filter((contact) => matchesFilters(contact, definition.filters));

  const createMembership = matches.length
    ? prisma.segmentMembership.createMany({
        data: matches.map((contact) => ({ segmentId, contactId: contact.id }))
      })
    : null;

  const tx: Prisma.PrismaPromise<unknown>[] = [
    prisma.segmentMembership.deleteMany({ where: { segmentId } }),
    prisma.segment.update({
      where: { id: segmentId },
      data: {
        lastComputedAt: new Date(),
        estimatedSize: matches.length
      }
    })
  ];

  if (createMembership) {
    tx.splice(1, 0, createMembership);
  }

  await prisma.$transaction(tx);

  return { total: matches.length };
}

export async function listSegments() {
  return prisma.segment.findMany({
    orderBy: { createdAt: "desc" }
  });
}

function hourOfWeek(date: Date): number {
  return date.getUTCDay() * 24 + date.getUTCHours();
}

export async function getSegmentHeatmap(segmentId: string): Promise<SegmentHeatmap> {
  const messages = await prisma.message.findMany({
    where: {
      sentAt: { not: null },
      contact: {
        segmentMemberships: {
          some: { segmentId }
        }
      }
    },
    select: {
      sentAt: true,
      outcome: {
        select: { clickedAt: true }
      }
    }
  });

  const cells = Array.from({ length: 168 }, (_, hour) => ({
    hour,
    sends: 0,
    clicks: 0,
    rate: 0
  }));

  messages.forEach((message) => {
    if (!message.sentAt) {
      return;
    }
    const hour = hourOfWeek(message.sentAt);
    const cell = cells[hour];
    if (!cell) {
      return;
    }
    cell.sends += 1;
    if (message.outcome?.clickedAt) {
      cell.clicks += 1;
    }
  });

  let bestHour: number | null = null;
  let bestRate = 0;

  cells.forEach((cell) => {
    cell.rate = cell.sends > 0 ? Number((cell.clicks / cell.sends).toFixed(4)) : 0;
    if (cell.sends > 0 && cell.rate >= bestRate) {
      bestRate = cell.rate;
      bestHour = cell.hour;
    }
  });

  return {
    segmentId,
    cells,
    bestHour,
    bestRate
  };
}

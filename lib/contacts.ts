import { ContactStatus, HygieneRiskLevel, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type ContactFilterInput = {
  status?: ContactStatus | null;
  tag?: string | null;
  timezone?: string | null;
};

export type ContactListItem = {
  id: string;
  email: string;
  status: ContactStatus;
  tags: string[];
  timezone: string | null;
  lifecycleStage: string | null;
  lastEventAt: Date | null;
  lastMessageSentAt: Date | null;
  hygieneRiskLevel: HygieneRiskLevel;
  hygieneScore: number | null;
};

export type ParsedCsvContact = {
  email: string;
  timezone?: string | null;
  tags?: string[];
};

export function buildContactWhereClause(filter: ContactFilterInput): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = {};

  if (filter.status) {
    where.status = filter.status;
  }

  if (filter.timezone) {
    where.timezone = filter.timezone;
  }

  if (filter.tag) {
    where.tags = {
      has: filter.tag
    };
  }

  return where;
}

export async function listContacts(filter: ContactFilterInput): Promise<ContactListItem[]> {
  const contacts = await prisma.contact.findMany({
    where: buildContactWhereClause(filter),
    orderBy: { email: "asc" }
  });

  return contacts.map((contact) => ({
    id: contact.id,
    email: contact.email,
    status: contact.status,
    tags: contact.tags,
    timezone: contact.timezone,
    lifecycleStage: contact.lifecycleStage,
    lastEventAt: contact.lastEventAt,
    lastMessageSentAt: contact.lastMessageSentAt,
    hygieneRiskLevel: contact.hygieneRiskLevel,
    hygieneScore: contact.hygieneScore ?? null
  }));
}

export function parseContactsCsv(csv: string): ParsedCsvContact[] {
  const rows = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length === 0) {
    return [];
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.split(",").map((header) => header.trim().toLowerCase());

  const emailIndex = headers.indexOf("email");
  if (emailIndex === -1) {
    throw new Error("CSV must include an email column");
  }

  const timezoneIndex = headers.indexOf("timezone");
  const tagsIndex = headers.indexOf("tags");

  return dataRows.map((row) => {
    const columns = row.split(",");
    const email = (columns[emailIndex] ?? "").trim().toLowerCase();
    if (!email) {
      throw new Error("Email is required for each row");
    }

    const timezone = timezoneIndex >= 0 ? (columns[timezoneIndex] ?? "").trim() || null : null;
    const tagsRaw = tagsIndex >= 0 ? (columns[tagsIndex] ?? "").trim() : "";
    const tags = tagsRaw
      ? tagsRaw
          .split(/[;|]/)
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    return {
      email,
      timezone,
      tags
    };
  });
}

export async function importContactsFromCsv(csv: string): Promise<{ created: number; updated: number }> {
  const rows = parseContactsCsv(csv);

  if (rows.length === 0) {
    return { created: 0, updated: 0 };
  }

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const result = await prisma.contact.upsert({
      where: { email: row.email },
      update: {
        timezone: row.timezone,
        tags: row.tags ?? []
      },
      create: {
        email: row.email,
        timezone: row.timezone,
        tags: row.tags ?? [],
        status: ContactStatus.ACTIVE
      }
    });

    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created += 1;
    } else {
      updated += 1;
    }
  }

  return { created, updated };
}

export async function listDistinctContactValues(filter: ContactFilterInput): Promise<{
  timezones: string[];
  tags: string[];
}> {
  const contacts = await prisma.contact.findMany({
    where: buildContactWhereClause(filter),
    select: {
      timezone: true,
      tags: true
    }
  });

  const timezones = new Set<string>();
  const tags = new Set<string>();

  contacts.forEach((contact) => {
    if (contact.timezone) {
      timezones.add(contact.timezone);
    }
    contact.tags.forEach((tag) => tags.add(tag));
  });

  return {
    timezones: Array.from(timezones).sort(),
    tags: Array.from(tags).sort()
  };
}

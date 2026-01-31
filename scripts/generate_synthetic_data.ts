import "dotenv/config";
import { PrismaClient, ContactStatus, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_CONTACTS = 500;
const DEFAULT_DAYS = 14;
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles"
];
const LIFECYCLE_STAGES = ["trial", "active", "inactive"] as const;
const SEGMENT_FACTORS: Record<(typeof LIFECYCLE_STAGES)[number], number> = {
  trial: 1.2,
  active: 1.0,
  inactive: 0.6
};

const SYNTHETIC_EVENTS = [
  "synthetic:signed_up",
  "synthetic:feature_used",
  "synthetic:activated",
  "synthetic:inactive_7d"
];

function parseArgs() {
  const args = process.argv.slice(2);
  let contacts = DEFAULT_CONTACTS;
  let days = DEFAULT_DAYS;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--contacts" && args[i + 1]) {
      contacts = Number(args[i + 1]);
      i += 1;
    } else if (arg === "--days" && args[i + 1]) {
      days = Number(args[i + 1]);
      i += 1;
    }
  }

  return {
    contacts: Number.isFinite(contacts) && contacts > 0 ? Math.floor(contacts) : DEFAULT_CONTACTS,
    days: Number.isFinite(days) && days > 0 ? Math.floor(days) : DEFAULT_DAYS
  };
}

function stringHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function pick<T>(array: T[], rng: () => number): T {
  const index = Math.floor(rng() * array.length);
  return array[index % array.length];
}

function generatePropensity(rng: () => number): number {
  const base = rng() * 0.7 + 0.15; // 0.15 - 0.85
  return Number(base.toFixed(3));
}

function generatePreferredWindow(rng: () => number): { hourOfWeek: number; windowLabel: string } {
  const bucket = Math.floor(rng() * 4);
  const windowLabel = ["morning", "midday", "evening", "late-night"][bucket];
  const baseHour = bucket * 6; // 4 windows per day
  const dayOffset = Math.floor(rng() * 7);
  const hourOffset = Math.floor(rng() * 6);
  const hourOfWeek = dayOffset * 24 + baseHour + hourOffset;
  return { hourOfWeek, windowLabel };
}

function computeTimeFactor(sendAt: Date, preferredHour: number): number {
  const sendHour = sendAt.getUTCDay() * 24 + sendAt.getUTCHours();
  const diff = Math.abs(sendHour - preferredHour);
  if (diff <= 2) {
    return 1.2;
  }
  if (diff <= 6) {
    return 1.0;
  }
  return 0.7;
}

function computeFatigueFactor(lastSend: Date | null, currentSend: Date): number {
  if (!lastSend) {
    return 1.0;
  }
  const hours = (currentSend.getTime() - lastSend.getTime()) / (1000 * 60 * 60);
  if (hours < 12) {
    return 0.6;
  }
  if (hours < 24) {
    return 0.8;
  }
  return 1.0;
}

async function seedContacts(total: number) {
  const contacts: { id: string; email: string; lifecycleStage: string; propensity: number; preferredHour: number }[] = [];

  for (let index = 0; index < total; index += 1) {
    const email = `synthetic+${index.toString().padStart(3, "0")}@resend.dev`;
    const hash = stringHash(email);
    const rng = createRng(hash);
    const lifecycleStage = pick([...LIFECYCLE_STAGES], rng);
    const propensity = generatePropensity(rng);
    const { hourOfWeek, windowLabel } = generatePreferredWindow(rng);
    const timezone = pick([...TIMEZONES], rng);

    const contact = await prisma.contact.upsert({
      where: { email },
      update: {
        timezone,
        lifecycleStage,
        propensity,
        tags: ["synthetic", `segment=${lifecycleStage}`, `preferred_window=${windowLabel}`],
        status: ContactStatus.ACTIVE
      },
      create: {
        email,
        timezone,
        lifecycleStage,
        propensity,
        status: ContactStatus.ACTIVE,
        tags: ["synthetic", `segment=${lifecycleStage}`, `preferred_window=${windowLabel}`]
      }
    });

    contacts.push({
      id: contact.id,
      email,
      lifecycleStage,
      propensity,
      preferredHour: hourOfWeek
    });
  }

  return contacts;
}

async function seedEvents(contacts: { id: string; lifecycleStage: string }[], days: number) {
  await prisma.event.deleteMany({
    where: {
      eventName: {
        in: SYNTHETIC_EVENTS
      }
    }
  });

  const now = new Date();

  for (const contact of contacts) {
    const baseHash = stringHash(contact.id);
    const rng = createRng(baseHash);

    const events = SYNTHETIC_EVENTS.map((eventName, index) => {
      const daysAgo = Math.min(days - 1, Math.floor(rng() * days));
      const timestamp = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000 - index * 60 * 1000);
      return {
        contactId: contact.id,
        eventName,
        timestamp,
        properties: {
          synthetic: true,
          lifecycleStage: contact.lifecycleStage
        }
      };
    });

    await prisma.event.createMany({ data: events });

    const latestEvent = events.reduce((recent, event) => (event.timestamp > recent.timestamp ? event : recent));
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        lastEventAt: latestEvent.timestamp
      }
    });
  }
}

async function generateClicks(contacts: {
  id: string;
  email: string;
  lifecycleStage: string;
  propensity: number;
  preferredHour: number;
}[]) {
  const messages = await prisma.message.findMany({
    where: {
      sentAt: {
        not: null
      }
    },
    include: {
      contact: {
        select: {
          id: true,
          lastMessageSentAt: true
        }
      }
    }
  });

  let processed = 0;
  const lastSendMap = new Map<string, Date | null>();

  for (const message of messages) {
    const contactInfo = contacts.find((contact) => contact.id === message.contactId);
    if (!contactInfo || !message.sentAt) {
      continue;
    }

    const hash = stringHash(`${message.id}:${contactInfo.email}`);
    const rng = createRng(hash);
    const segmentFactor = SEGMENT_FACTORS[contactInfo.lifecycleStage as keyof typeof SEGMENT_FACTORS] ?? 1.0;
    const previousSend = lastSendMap.get(message.contactId) ?? message.contact.lastMessageSentAt ?? null;
    const timeFactor = computeTimeFactor(message.sentAt, contactInfo.preferredHour);
    const fatigueFactor = computeFatigueFactor(previousSend, message.sentAt);
    const baselineTimeFactor = 0.9;
    const baselineProbabilityRaw = contactInfo.propensity * segmentFactor * baselineTimeFactor * fatigueFactor;
    const probability = Math.min(0.95, Math.max(0.01, contactInfo.propensity * segmentFactor * timeFactor * fatigueFactor));
    const baselineProbability = Math.min(0.95, Math.max(0.01, baselineProbabilityRaw));
    const clicked = rng() < probability;

    const clickedAt = clicked
      ? new Date(message.sentAt.getTime() + Math.floor(rng() * 175 + 5) * 60 * 1000)
      : null;

    await prisma.messageOutcome.upsert({
      where: { messageId: message.id },
      update: {
        clickProbability: new Prisma.Decimal(probability.toFixed(3)),
        clickedAt,
        lastEvent: clicked ? "clicked" : "delivered",
        metadata: {
          synthetic: true,
          probability,
          baselineProbability,
          segmentFactor,
          timeFactor,
          fatigueFactor,
          recommendedHour: contactInfo.preferredHour
        }
      },
      create: {
        messageId: message.id,
        clickProbability: new Prisma.Decimal(probability.toFixed(3)),
        clickedAt,
        deliveredAt: message.sentAt,
        lastEvent: clicked ? "clicked" : "delivered",
        metadata: {
          synthetic: true,
          probability,
          baselineProbability,
          segmentFactor,
          timeFactor,
          fatigueFactor,
          recommendedHour: contactInfo.preferredHour
        }
      }
    });

    await prisma.contact.update({
      where: { id: message.contactId },
      data: {
        lastMessageSentAt: message.sentAt
      }
    });

    lastSendMap.set(message.contactId, message.sentAt);

    processed += 1;
  }

  return processed;
}

async function main() {
  const { contacts: totalContacts, days } = parseArgs();
  console.log(`Generating synthetic data for ${totalContacts} contacts over ${days} days`);

  const contacts = await seedContacts(totalContacts);
  await seedEvents(contacts, days);
  const clicks = await generateClicks(contacts);

  console.log(`Synthetic contacts ready: ${contacts.length}`);
  console.log(`Synthetic click outcomes applied to ${clicks} messages`);
}

main()
  .catch((error) => {
    console.error("Synthetic data generation failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { ContactStatus } from "@prisma/client";

export type TestContactSpec = {
  email: string;
  status: ContactStatus;
  tags: string[];
  timezone: string;
  lifecycleStage: string;
  propensity: number;
};

type OutcomeKey = "delivered" | "bounced" | "suppressed" | "complained";

type OutcomeConfig = {
  key: OutcomeKey;
  count: number;
  status: ContactStatus;
  basePropensity: number;
  tags: string[];
  lifecycleStage: string;
};

const OUTCOME_CONFIGS: OutcomeConfig[] = [
  {
    key: "delivered",
    count: 200,
    status: ContactStatus.ACTIVE,
    basePropensity: 0.78,
    tags: ["test-list", "outcome=delivered"],
    lifecycleStage: "active"
  },
  {
    key: "bounced",
    count: 20,
    status: ContactStatus.BOUNCED,
    basePropensity: 0.04,
    tags: ["test-list", "outcome=bounced"],
    lifecycleStage: "inactive"
  },
  {
    key: "suppressed",
    count: 5,
    status: ContactStatus.SUPPRESSED,
    basePropensity: 0.01,
    tags: ["test-list", "outcome=suppressed"],
    lifecycleStage: "suppressed"
  },
  {
    key: "complained",
    count: 3,
    status: ContactStatus.COMPLAINED,
    basePropensity: 0.0,
    tags: ["test-list", "outcome=complained"],
    lifecycleStage: "complained"
  }
];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles"
];

function padLabel(index: number): string {
  return index.toString().padStart(3, "0");
}

export function generateTestContactSpecs(): TestContactSpec[] {
  const specs: TestContactSpec[] = [];

  OUTCOME_CONFIGS.forEach((config) => {
    for (let i = 1; i <= config.count; i += 1) {
      const label = padLabel(i);
      const email = `${config.key}+${label}@resend.dev`;
      const timezone = TIMEZONES[(i - 1) % TIMEZONES.length];
      const propensity = Number((config.basePropensity + (i % 5) * 0.01).toFixed(2));

      specs.push({
        email,
        status: config.status,
        tags: config.tags,
        timezone,
        lifecycleStage: config.lifecycleStage,
        propensity: Math.min(propensity, 0.95)
      });
    }
  });

  return specs;
}

export function summarizeOutcomeCounts(specs: TestContactSpec[]): Record<OutcomeKey, number> {
  return specs.reduce(
    (acc, spec) => {
      if (spec.email.startsWith("delivered")) {
        acc.delivered += 1;
      } else if (spec.email.startsWith("bounced")) {
        acc.bounced += 1;
      } else if (spec.email.startsWith("suppressed")) {
        acc.suppressed += 1;
      } else if (spec.email.startsWith("complained")) {
        acc.complained += 1;
      }
      return acc;
    },
    { delivered: 0, bounced: 0, suppressed: 0, complained: 0 }
  );
}

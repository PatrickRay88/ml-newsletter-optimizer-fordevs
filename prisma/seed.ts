import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_MODE = "TEST" as const;
const allSegmentDefinition = {
  type: "all"
} as const;

const templateSeeds = [
  {
    name: "Welcome Aboard",
    category: "onboarding",
    subject: "Welcome to Email Autopilot",
    previewText: "Kickstart your lifecycle experience in minutes.",
    html: "<h1>Welcome!</h1><p>We are excited to help you automate your lifecycle emails.</p>"
  },
  {
    name: "Setup Reminder",
    category: "activation",
    subject: "Complete your setup",
    previewText: "Run the onboarding checklist and send a test broadcast.",
    html: "<h1>Setup Reminder</h1><p>Finish your onboarding checklist to unlock analytics.</p>"
  },
  {
    name: "Feature Highlight",
    category: "product",
    subject: "This week's feature highlight",
    previewText: "Learn how Email Autopilot boosts your engagement.",
    html: "<h1>Feature Highlight</h1><p>Discover the autopilot features that drive uplift.</p>"
  },
  {
    name: "Weekly Update",
    category: "newsletter",
    subject: "Your weekly deliverability snapshot",
    previewText: "Synthetic data highlights and CTR trends.",
    html: "<h1>Weekly Update</h1><p>Review your engagement metrics and ML recommendations.</p>"
  },
  {
    name: "Winback Sequence",
    category: "re-engagement",
    subject: "We miss you — come back",
    previewText: "Bring lapsed contacts back with a targeted winback email.",
    html: "<h1>We miss you</h1><p>Re-engage with your product and unlock new features.</p>"
  }
];

async function main(): Promise<void> {
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      mode: DEFAULT_MODE,
      testModeEnabled: true
    }
  });

  for (const template of templateSeeds) {
    await prisma.template.upsert({
      where: { name: template.name },
      update: {
        category: template.category,
        subject: template.subject,
        previewText: template.previewText,
        html: template.html
      },
      create: template
    });
  }

  await prisma.segment.upsert({
    where: { name: "All Contacts" },
    update: {
      description: "System segment containing every active contact",
      definition: allSegmentDefinition,
      isSystem: true
    },
    create: {
      name: "All Contacts",
      description: "System segment containing every active contact",
      definition: allSegmentDefinition,
      isSystem: true
    }
  });
}

main()
  .then(() => {
    console.log("Seed data applied successfully");
  })
  .catch((error) => {
    console.error("Failed to seed database", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

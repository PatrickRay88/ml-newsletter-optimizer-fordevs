import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateTestContactSpecs, summarizeOutcomeCounts } from "@/lib/test_contacts";
import { recordTestListCreated } from "@/lib/settings";

export async function POST() {
  const startedAt = Date.now();
  const specs = generateTestContactSpecs();
  const emails = specs.map((spec) => spec.email);

  try {
    const existingEmails = await prisma.contact.findMany({
      where: {
        email: {
          in: emails
        }
      },
      select: { email: true }
    });

    const existingSet = new Set(existingEmails.map((entry) => entry.email));

    await prisma.$transaction(
      specs.map((spec) =>
        prisma.contact.upsert({
          where: { email: spec.email },
          create: {
            email: spec.email,
            status: spec.status,
            tags: spec.tags,
            timezone: spec.timezone,
            lifecycleStage: spec.lifecycleStage,
            propensity: new Prisma.Decimal(spec.propensity),
            lastEventAt: null,
            lastMessageSentAt: null
          },
          update: {
            status: spec.status,
            tags: spec.tags,
            timezone: spec.timezone,
            lifecycleStage: spec.lifecycleStage,
            propensity: new Prisma.Decimal(spec.propensity)
          }
        })
      )
    );

    const timestamp = new Date();
    await recordTestListCreated(timestamp);

    const counts = summarizeOutcomeCounts(specs);
    const createdCount = specs.length - existingSet.size;
    const updatedCount = existingSet.size;

    const durationMs = Date.now() - startedAt;

    return NextResponse.json({
      success: true,
      message: "Test contacts ready",
      totals: counts,
      upserts: {
        created: createdCount,
        updated: updatedCount
      },
      durationMs,
      testListCreatedAt: timestamp.toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create test contacts";
    return NextResponse.json({
      message,
      success: false
    }, { status: 500 });
  }
}

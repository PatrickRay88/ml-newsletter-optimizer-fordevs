import { ContactStatus, HygieneRiskLevel, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type HygieneComputationInput = {
  id: string;
  status: ContactStatus;
  tags: string[];
  lastEventAt: Date | null;
  lastMessageSentAt: Date | null;
  propensity: Prisma.Decimal | number | null;
  suppressions: Array<{ id: string; reason: string }>;
};

export type HygieneComputationResult = {
  contactId: string;
  riskLevel: HygieneRiskLevel;
  score: number;
  reasons: string[];
  shouldSuppress: boolean;
};

export type HygieneSweepOptions = {
  suppressHighRisk?: boolean;
  limit?: number;
  now?: Date;
};

export type HygieneSweepSummary = {
  evaluated: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  suppressionsCreated: number;
  contactsSuppressed: number;
};

const HYGIENE_SUPPRESSION_REASON = "hygiene-risk";
const STALE_EVENT_THRESHOLD_DAYS = 60;
const STALE_SEND_THRESHOLD_DAYS = 90;
const LOW_PROPENSITY_THRESHOLD = 0.15;

export function computeHygieneScore(
  input: HygieneComputationInput,
  now = new Date()
): HygieneComputationResult {
  let riskLevel: HygieneRiskLevel = HygieneRiskLevel.LOW;
  let score = 20;
  const reasons: string[] = [];
  let shouldSuppress = false;

  const propensityValue = typeof input.propensity === "object" && input.propensity !== null
    ? Number(input.propensity)
    : input.propensity ?? 0;

  if (input.status === ContactStatus.BOUNCED) {
    riskLevel = HygieneRiskLevel.HIGH;
    score = 95;
    reasons.push("Hard bounce detected");
    shouldSuppress = true;
  } else if (input.status === ContactStatus.COMPLAINED) {
    riskLevel = HygieneRiskLevel.HIGH;
    score = 98;
    reasons.push("Complaint reported");
    shouldSuppress = true;
  } else if (input.status === ContactStatus.SUPPRESSED) {
    riskLevel = HygieneRiskLevel.HIGH;
    score = 90;
    reasons.push("Contact already suppressed");
    shouldSuppress = true;
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysSinceEvent = input.lastEventAt ? (now.getTime() - input.lastEventAt.getTime()) / msPerDay : Infinity;
  const daysSinceSend = input.lastMessageSentAt ? (now.getTime() - input.lastMessageSentAt.getTime()) / msPerDay : Infinity;

  if (riskLevel !== HygieneRiskLevel.HIGH) {
    if (daysSinceSend > STALE_SEND_THRESHOLD_DAYS) {
      riskLevel = HygieneRiskLevel.MEDIUM;
      score = Math.max(score, 65);
      reasons.push("No sends in last 90 days");
    }

    if (daysSinceEvent > STALE_EVENT_THRESHOLD_DAYS) {
      riskLevel = riskLevel === HygieneRiskLevel.LOW ? HygieneRiskLevel.MEDIUM : riskLevel;
      score = Math.max(score, 55);
      reasons.push("No engagement events in last 60 days");
    }

    if (propensityValue > 0 && propensityValue < LOW_PROPENSITY_THRESHOLD) {
      riskLevel = riskLevel === HygieneRiskLevel.LOW ? HygieneRiskLevel.MEDIUM : riskLevel;
      score = Math.max(score, 50);
      reasons.push("Low propensity segment");
    }

    if (riskLevel === HygieneRiskLevel.LOW && propensityValue >= LOW_PROPENSITY_THRESHOLD && daysSinceEvent < STALE_EVENT_THRESHOLD_DAYS) {
      score = 25;
      reasons.push("Healthy engagement");
    }
  }

  if (riskLevel === HygieneRiskLevel.HIGH && input.tags.includes("synthetic")) {
    // Synthetic contacts stay active for repeatable demos.
    shouldSuppress = false;
    reasons.push("Synthetic contact safeguard");
  }

  return {
    contactId: input.id,
    riskLevel,
    score,
    reasons,
    shouldSuppress
  };
}

export async function runHygieneSweep(options: HygieneSweepOptions = {}): Promise<HygieneSweepSummary> {
  const now = options.now ?? new Date();
  const contacts = await prisma.contact.findMany({
    take: options.limit,
    select: {
      id: true,
      status: true,
      tags: true,
      lastEventAt: true,
      lastMessageSentAt: true,
      propensity: true,
      hygieneRiskLevel: true,
      hygieneScore: true,
      suppressions: {
        select: {
          id: true,
          reason: true
        }
      }
    }
  });

  if (contacts.length === 0) {
    return {
      evaluated: 0,
      highRisk: 0,
      mediumRisk: 0,
      lowRisk: 0,
      suppressionsCreated: 0,
      contactsSuppressed: 0
    };
  }

  const evaluationRows: Prisma.HygieneEvaluationCreateManyInput[] = [];
  const suppressionRows: Prisma.SuppressionCreateManyInput[] = [];
  const contactUpdates: Array<{ id: string; data: Prisma.ContactUpdateInput }> = [];

  let highRisk = 0;
  let mediumRisk = 0;
  let lowRisk = 0;
  let suppressionsCreated = 0;
  let contactsSuppressed = 0;

  for (const contact of contacts) {
    const result = computeHygieneScore({
      id: contact.id,
      status: contact.status,
      tags: contact.tags,
      lastEventAt: contact.lastEventAt,
      lastMessageSentAt: contact.lastMessageSentAt,
      propensity: contact.propensity,
      suppressions: contact.suppressions
    }, now);

    if (result.riskLevel === HygieneRiskLevel.HIGH) {
      highRisk += 1;
    } else if (result.riskLevel === HygieneRiskLevel.MEDIUM) {
      mediumRisk += 1;
    } else {
      lowRisk += 1;
    }

    evaluationRows.push({
      contactId: contact.id,
      riskLevel: result.riskLevel,
      score: result.score,
      suppressed: result.shouldSuppress && options.suppressHighRisk !== false,
      reasons: { reasons: result.reasons }
    });

    const needsRiskUpdate =
      contact.hygieneRiskLevel !== result.riskLevel ||
      Math.abs((contact.hygieneScore ?? 0) - result.score) > 0.001;

    const updateData: Prisma.ContactUpdateInput = {};
    if (needsRiskUpdate) {
      updateData.hygieneRiskLevel = result.riskLevel;
      updateData.hygieneScore = result.score;
    }

    const shouldApplySuppression =
      result.riskLevel === HygieneRiskLevel.HIGH &&
      options.suppressHighRisk !== false &&
      !contact.tags.includes("synthetic");

    if (shouldApplySuppression) {
      const alreadySuppressed = contact.status === ContactStatus.SUPPRESSED;
      const hasSuppression = contact.suppressions.some((entry) => entry.reason === HYGIENE_SUPPRESSION_REASON);

      if (!alreadySuppressed) {
        updateData.status = ContactStatus.SUPPRESSED;
        contactsSuppressed += 1;
      }

      if (!hasSuppression) {
        suppressionRows.push({
          contactId: contact.id,
          reason: HYGIENE_SUPPRESSION_REASON,
          source: "system",
          notes: "Auto-suppressed due to hygiene risk"
        });
        suppressionsCreated += 1;
      }
    }

    if (Object.keys(updateData).length > 0) {
      contactUpdates.push({ id: contact.id, data: updateData });
    }
  }

  await prisma.$transaction(async (tx) => {
    if (evaluationRows.length > 0) {
      await tx.hygieneEvaluation.createMany({ data: evaluationRows });
    }

    for (const update of contactUpdates) {
      await tx.contact.update({ where: { id: update.id }, data: update.data });
    }

    if (suppressionRows.length > 0) {
      await tx.suppression.createMany({ data: suppressionRows });
    }
  });

  return {
    evaluated: contacts.length,
    highRisk,
    mediumRisk,
    lowRisk,
    suppressionsCreated,
    contactsSuppressed
  };
}

import {
  ContactStatus,
  FlowRunStatus,
  FlowStatus,
  FlowStepType,
  MessageStatus,
  Prisma
} from "@prisma/client";
import { prisma } from "./prisma";
import { buildTagRecord } from "./broadcasts";
import { recommendSendTime } from "./optimizer";
import { ResendError } from "./resend";
import { resolveEmailEngineAdapter } from "./engines/adapter";
import { computeHygieneScore } from "./hygiene";
import { buildHygieneFeatures, predictHygieneRisk } from "./hygiene_model";
import { getLatestHygieneModelVersion } from "./model_versions";

const SCHEDULE_THRESHOLD_MS = 5 * 60 * 1000;

type SendEmailImplementation = (params: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  tags?: Record<string, string>;
}) => Promise<{ id: string }>;

const defaultSendEmailImplementation: SendEmailImplementation = async (params) => {
  const engine = resolveEmailEngineAdapter();
  const result = await engine.sendEmail(params);
  return { id: result.messageId };
};

let sendEmail: SendEmailImplementation = defaultSendEmailImplementation;

export function setSendEmailImplementation(implementation: SendEmailImplementation) {
  sendEmail = implementation;
}

export function resetSendEmailImplementation() {
  sendEmail = defaultSendEmailImplementation;
}

type LoadedRun = Prisma.FlowRunGetPayload<{
  include: {
    flow: {
      include: {
        steps: true;
        template: { select: { id: true; subject: true; html: true } };
        segment: { select: { id: true } };
      };
    };
    contact: {
      select: {
        id: true;
        email: true;
        status: true;
        tags: true;
        timezone: true;
        lastMessageSentAt: true;
      };
    };
  };
}>;

export type CreateFlowInput = {
  name: string;
  triggerEventName: string;
  templateId: string;
  delayMinutes?: number | null;
  segmentId?: string | null;
  useOptimizer?: boolean;
  useHygieneModel?: boolean;
};

export type FlowOverview = Awaited<ReturnType<typeof getFlowsOverview>>[number];

type FlowModelConfig = {
  useSendTimeOptimizer: boolean;
  useHygieneModel: boolean;
};

function readFlowModelConfig(metadata: Prisma.JsonValue | null | undefined, fallbackUseOptimizer: boolean): FlowModelConfig {
  const config: FlowModelConfig = {
    useSendTimeOptimizer: fallbackUseOptimizer,
    useHygieneModel: false
  };

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return config;
  }

  const root = metadata as Record<string, unknown>;
  const ml = root.ml;
  if (ml && typeof ml === "object" && !Array.isArray(ml)) {
    const mlRecord = ml as Record<string, unknown>;
    if (typeof mlRecord.sendTimeOptimizer === "boolean") {
      config.useSendTimeOptimizer = mlRecord.sendTimeOptimizer;
    }
    if (typeof mlRecord.hygieneModel === "boolean") {
      config.useHygieneModel = mlRecord.hygieneModel;
    }
  }

  if (typeof root.useHygieneModel === "boolean") {
    config.useHygieneModel = root.useHygieneModel;
  }

  return config;
}

export async function createFlowDefinition(input: CreateFlowInput) {
  const modelConfig: FlowModelConfig = {
    useSendTimeOptimizer: input.useOptimizer ?? true,
    useHygieneModel: input.useHygieneModel ?? true
  };

  const steps: Prisma.FlowStepCreateManyFlowInput[] = [];
  let order = 1;

  steps.push({ order, type: FlowStepType.TRIGGER, config: { eventName: input.triggerEventName } });
  order += 1;

  if (input.delayMinutes && input.delayMinutes > 0) {
    steps.push({ order, type: FlowStepType.DELAY, config: { minutes: input.delayMinutes } });
    order += 1;
  }

  if (input.segmentId) {
    steps.push({ order, type: FlowStepType.SEGMENT_FILTER, config: { segmentId: input.segmentId } });
    order += 1;
  }

  steps.push({ order, type: FlowStepType.SEND_TEMPLATE, config: { templateId: input.templateId } });

  const flow = await prisma.flow.create({
    data: {
      name: input.name,
      status: FlowStatus.DRAFT,
      triggerEventName: input.triggerEventName,
      delayMinutes: input.delayMinutes ?? null,
      useOptimizer: modelConfig.useSendTimeOptimizer,
      segmentId: input.segmentId ?? null,
      templateId: input.templateId,
      metadata: {
        ml: {
          sendTimeOptimizer: modelConfig.useSendTimeOptimizer,
          hygieneModel: modelConfig.useHygieneModel
        },
        version: 1
      },
      steps: { createMany: { data: steps } }
    },
    include: {
      steps: { orderBy: { order: "asc" } },
      template: { select: { id: true, name: true, subject: true } },
      segment: { select: { id: true, name: true } }
    }
  });

  return flow;
}

export async function getFlowsOverview() {
  return prisma.flow.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      steps: { orderBy: { order: "asc" } },
      template: { select: { id: true, name: true, subject: true } },
      segment: { select: { id: true, name: true } },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          contact: { select: { id: true, email: true, status: true } },
          message: {
            select: {
              id: true,
              status: true,
              resendMessageId: true,
              scheduledSendAt: true,
              sentAt: true
            }
          }
        }
      }
    }
  });
}

export type TriggerFlowEventInput = {
  contactId: string;
  eventName: string;
  eventId?: string;
  properties?: Prisma.JsonValue;
  occurredAt?: Date;
};

export type TriggerFlowSummary = {
  createdRuns: number;
  skippedFlows: number;
};

export async function triggerFlowsForEvent(input: TriggerFlowEventInput): Promise<TriggerFlowSummary> {
  const now = input.occurredAt ?? new Date();
  const contact = await prisma.contact.findUnique({
    where: { id: input.contactId },
    select: {
      id: true,
      email: true,
      status: true
    }
  });

  if (!contact || !contact.email || contact.status !== ContactStatus.ACTIVE) {
    return { createdRuns: 0, skippedFlows: 0 };
  }

  const flows = await prisma.flow.findMany({
    where: {
      status: FlowStatus.ACTIVE,
      triggerEventName: input.eventName
    },
    include: {
      steps: { orderBy: { order: "asc" } }
    }
  });

  if (flows.length === 0) {
    return { createdRuns: 0, skippedFlows: 0 };
  }

  let createdRuns = 0;
  let skippedFlows = 0;

  for (const flow of flows) {
    const firstAction = flow.steps.find((step) => step.type !== FlowStepType.TRIGGER);

    if (!firstAction) {
      skippedFlows += 1;
      continue;
    }

    await prisma.flowRun.create({
      data: {
        flowId: flow.id,
        contactId: contact.id,
        status: FlowRunStatus.PENDING,
        nextStepOrder: firstAction.order,
        scheduledAt: now,
        context: {
          eventId: input.eventId ?? null,
          eventName: input.eventName,
          triggeredAt: now.toISOString(),
          properties: input.properties ?? null
        }
      }
    });

    createdRuns += 1;
  }

  return { createdRuns, skippedFlows };
}

export type ProcessFlowRunsOptions = {
  now?: Date;
  limit?: number;
};

export type ProcessFlowRunsSummary = {
  evaluated: number;
  completed: number;
  rescheduled: number;
  cancelled: number;
  failed: number;
};

export async function processDueFlowRuns(options: ProcessFlowRunsOptions = {}): Promise<ProcessFlowRunsSummary> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 20;

  const runs: LoadedRun[] = await prisma.flowRun.findMany({
    where: {
      status: { in: [FlowRunStatus.PENDING, FlowRunStatus.WAITING] },
      scheduledAt: { lte: now }
    },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    include: {
      contact: {
        select: {
          id: true,
          email: true,
          status: true,
          tags: true,
          timezone: true,
          lastMessageSentAt: true
        }
      },
      flow: {
        include: {
          steps: { orderBy: { order: "asc" } },
          template: { select: { id: true, subject: true, html: true } },
          segment: { select: { id: true } }
        }
      }
    }
  });

  const summary: ProcessFlowRunsSummary = {
    evaluated: runs.length,
    completed: 0,
    rescheduled: 0,
    cancelled: 0,
    failed: 0
  };

  for (const run of runs) {
    try {
      const result = await processSingleRun(run, now);
      if (result.completed) {
        summary.completed += 1;
      }
      if (result.rescheduled) {
        summary.rescheduled += 1;
      }
      if (result.cancelled) {
        summary.cancelled += 1;
      }
    } catch (error) {
      summary.failed += 1;
      await prisma.flowRun.update({
        where: { id: run.id },
        data: {
          status: FlowRunStatus.FAILED,
          cancelledReason: error instanceof Error ? error.message : "Flow processing failed"
        }
      });
    }
  }

  return summary;
}

type RunResult = {
  completed: boolean;
  rescheduled: boolean;
  cancelled: boolean;
};

async function processSingleRun(run: LoadedRun, now: Date): Promise<RunResult> {
  const steps = run.flow.steps;
  let pointer = run.nextStepOrder;

  while (true) {
    const step = steps.find((candidate) => candidate.order === pointer);

    if (!step) {
      await prisma.flowRun.update({
        where: { id: run.id },
        data: {
          status: FlowRunStatus.COMPLETED,
          completedAt: now,
          nextStepOrder: pointer
        }
      });
      return { completed: true, rescheduled: false, cancelled: false };
    }

    switch (step.type) {
      case FlowStepType.DELAY: {
        const minutes = extractDelayMinutes(step, run.flow.delayMinutes);

        if (!minutes || minutes <= 0) {
          pointer = getNextOrder(pointer, steps);
          continue;
        }

        const scheduledAt = new Date(now.getTime() + minutes * 60 * 1000);
        await prisma.flowRun.update({
          where: { id: run.id },
          data: {
            status: FlowRunStatus.WAITING,
            scheduledAt,
            nextStepOrder: getNextOrder(pointer, steps)
          }
        });

        return { completed: false, rescheduled: true, cancelled: false };
      }
      case FlowStepType.SEGMENT_FILTER: {
        const segmentId = extractSegmentId(step, run.flow.segmentId);

        if (segmentId) {
          const membership = await prisma.segmentMembership.findFirst({
            where: { segmentId, contactId: run.contactId },
            select: { id: true }
          });

          if (!membership) {
            await prisma.flowRun.update({
              where: { id: run.id },
              data: {
                status: FlowRunStatus.CANCELLED,
                cancelledReason: "Contact no longer in segment",
                completedAt: now,
                nextStepOrder: pointer
              }
            });

            return { completed: false, rescheduled: false, cancelled: true };
          }
        }

        pointer = getNextOrder(pointer, steps);
        continue;
      }
      case FlowStepType.SEND_TEMPLATE: {
        return executeSendStep(run, now);
      }
      default: {
        pointer = getNextOrder(pointer, steps);
        continue;
      }
    }
  }
}

function extractDelayMinutes(step: { config: Prisma.JsonValue | null }, fallback?: number | null) {
  if (step.config && typeof step.config === "object" && step.config !== null && "minutes" in step.config) {
    const value = (step.config as { minutes?: unknown }).minutes;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return fallback ?? 0;
}

function extractSegmentId(step: { config: Prisma.JsonValue | null }, fallback?: string | null) {
  if (step.config && typeof step.config === "object" && step.config !== null && "segmentId" in step.config) {
    const value = (step.config as { segmentId?: unknown }).segmentId;
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return fallback ?? null;
}

function getNextOrder(current: number, steps: { order: number }[]): number {
  const candidates = steps
    .map((step) => step.order)
    .filter((order) => order > current)
    .sort((a, b) => a - b);

  if (candidates.length === 0) {
    return current + 1;
  }

  return candidates[0];
}

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (value && typeof value === "object") {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function evaluateFlowHygiene(contactId: string, now: Date) {
  const [contact, hygieneModel] = await Promise.all([
    prisma.contact.findUnique({
      where: { id: contactId },
      select: {
        id: true,
        status: true,
        tags: true,
        lastEventAt: true,
        lastMessageSentAt: true,
        propensity: true,
        suppressions: {
          select: {
            id: true,
            reason: true
          }
        },
        messages: {
          select: {
            sentAt: true,
            outcome: {
              select: {
                clickedAt: true
              }
            }
          }
        }
      }
    }),
    getLatestHygieneModelVersion()
  ]);

  if (!contact) {
    throw new Error("Contact not found for hygiene evaluation");
  }

  const modelMetadata = (hygieneModel?.metadata ?? {}) as { weights?: number[]; baseRate?: number };
  const modelWeights = Array.isArray(modelMetadata.weights) ? modelMetadata.weights : null;
  const baseRate = typeof modelMetadata.baseRate === "number" ? modelMetadata.baseRate : 0.05;

  const totalSends = contact.messages.filter((message) => Boolean(message.sentAt)).length;
  const deliveredNotClicked = contact.messages.filter(
    (message) => Boolean(message.sentAt) && !message.outcome?.clickedAt
  ).length;
  const deliveredNotClickedRatio = totalSends > 0 ? deliveredNotClicked / totalSends : 0;

  const featureVector = buildHygieneFeatures({
    lastEventAt: contact.lastEventAt,
    lastMessageSentAt: contact.lastMessageSentAt,
    propensity: toNumber(contact.propensity),
    deliveredNotClickedRatio,
    now
  }).features;

  const modelScore = predictHygieneRisk(modelWeights, featureVector, baseRate);
  const result = computeHygieneScore(
    {
      id: contact.id,
      status: contact.status,
      tags: contact.tags,
      lastEventAt: contact.lastEventAt,
      lastMessageSentAt: contact.lastMessageSentAt,
      propensity: contact.propensity,
      suppressions: contact.suppressions,
      deliveredNotClickedRatio,
      modelScore
    },
    now
  );

  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contact.id },
      data: {
        hygieneRiskLevel: result.riskLevel,
        hygieneScore: result.score
      }
    }),
    prisma.hygieneEvaluation.create({
      data: {
        contactId: contact.id,
        riskLevel: result.riskLevel,
        score: result.score,
        suppressed: result.shouldSuppress,
        reasons: { reasons: result.reasons }
      }
    })
  ]);

  return result;
}

async function executeSendStep(run: LoadedRun, now: Date): Promise<RunResult> {
  const contact = run.contact;

  if (!contact || !contact.email) {
    await prisma.flowRun.update({
      where: { id: run.id },
      data: {
        status: FlowRunStatus.CANCELLED,
        cancelledReason: "Contact missing email",
        completedAt: now
      }
    });
    return { completed: false, rescheduled: false, cancelled: true };
  }

  if (contact.status !== ContactStatus.ACTIVE) {
    await prisma.flowRun.update({
      where: { id: run.id },
      data: {
        status: FlowRunStatus.CANCELLED,
        cancelledReason: `Contact status is ${contact.status}`,
        completedAt: now
      }
    });
    return { completed: false, rescheduled: false, cancelled: true };
  }

  const modelConfig = readFlowModelConfig(run.flow.metadata, run.flow.useOptimizer);

  if (modelConfig.useHygieneModel) {
    const hygieneResult = await evaluateFlowHygiene(contact.id, now);
    if (hygieneResult.shouldSuppress) {
      await prisma.flowRun.update({
        where: { id: run.id },
        data: {
          status: FlowRunStatus.CANCELLED,
          cancelledReason: `Blocked by hygiene model (${hygieneResult.riskLevel} risk, score ${hygieneResult.score.toFixed(1)})`,
          completedAt: now
        }
      });
      return { completed: false, rescheduled: false, cancelled: true };
    }
  }

  const useOptimizer = modelConfig.useSendTimeOptimizer;
  let recommendedAt: Date | null = null;
  if (useOptimizer) {
    try {
      const recommendation = await recommendSendTime(contact.id, now);
      recommendedAt = recommendation.recommendedAt;
    } catch (error) {
      console.warn("Flow optimizer recommendation failed", error);
    }
  }

  const shouldSchedule = Boolean(
    recommendedAt && recommendedAt.getTime() - now.getTime() > SCHEDULE_THRESHOLD_MS
  );

  if (shouldSchedule && recommendedAt) {
    const data: Prisma.MessageCreateInput = {
      contact: { connect: { id: contact.id } },
      template: { connect: { id: run.flow.templateId } },
      status: MessageStatus.SCHEDULED,
      scheduledSendAt: recommendedAt,
      flowRun: { connect: { id: run.id } }
    };

    await prisma.$transaction([
      prisma.message.create({ data }),
      prisma.flowRun.update({
        where: { id: run.id },
        data: {
          status: FlowRunStatus.COMPLETED,
          completedAt: now,
          nextStepOrder: getNextOrder(run.nextStepOrder, run.flow.steps)
        }
      })
    ]);

    return { completed: true, rescheduled: false, cancelled: false };
  }

  try {
    const result = await sendEmail({
      to: contact.email,
      subject: run.flow.template.subject,
      html: run.flow.template.html,
      tags: buildTagRecord(contact.tags ?? [])
    });

    const sentAt = new Date();

    await prisma.$transaction([
      prisma.message.create({
        data: {
          contactId: contact.id,
          templateId: run.flow.templateId,
          resendMessageId: result.id,
          status: MessageStatus.SENT,
          sentAt,
          flowRunId: run.id
        }
      }),
      prisma.contact.update({
        where: { id: contact.id },
        data: { lastMessageSentAt: sentAt }
      }),
      prisma.flowRun.update({
        where: { id: run.id },
        data: {
          status: FlowRunStatus.COMPLETED,
          completedAt: now,
          nextStepOrder: getNextOrder(run.nextStepOrder, run.flow.steps)
        }
      })
    ]);
    return { completed: true, rescheduled: false, cancelled: false };
  } catch (error) {
    if (error instanceof ResendError) {
      await prisma.flowRun.update({
        where: { id: run.id },
        data: {
          status: FlowRunStatus.FAILED,
          cancelledReason: error.message
        }
      });
      throw error;
    }

    await prisma.flowRun.update({
      where: { id: run.id },
      data: {
        status: FlowRunStatus.FAILED,
        cancelledReason: error instanceof Error ? error.message : "Failed to send flow message"
      }
    });
    throw error;
  }
}

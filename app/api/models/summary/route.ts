import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function safeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

function readSampleCount(metrics: unknown, key: "messages" | "contacts"): number {
  if (!metrics || typeof metrics !== "object") {
    return 0;
  }
  const candidate = metrics as {
    samples?: {
      messages?: number;
      contacts?: number;
    };
  };
  const value = candidate.samples?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readBaselineProbability(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as { baselineProbability?: unknown }).baselineProbability;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function toPercent(value: number): number {
  return Number((value * 100).toFixed(2));
}

type OptimizerStatus = "warming_up" | "insufficient_data" | "no_baseline" | "healthy" | "underperforming";

function chooseOptimizerStatus(input: {
  messageSamples: number;
  optimizedDelivered: number;
  baselineSamples: number;
  upliftVsControlPct: number | null;
  upliftVsBaselinePct: number | null;
}): { status: OptimizerStatus; note: string } {
  if (input.messageSamples < 200) {
    return {
      status: "warming_up",
      note: "Need more historical sends before quality estimates stabilize"
    };
  }

  if (input.optimizedDelivered < 50) {
    return {
      status: "insufficient_data",
      note: "Need more delivered optimizer messages to measure performance"
    };
  }

  const primaryUplift = input.upliftVsControlPct ?? input.upliftVsBaselinePct;
  if (primaryUplift === null) {
    if (input.baselineSamples < 30) {
      return {
        status: "no_baseline",
        note: "Not enough baseline estimates yet; compare against manual sends"
      };
    }

    return {
      status: "insufficient_data",
      note: "Not enough control/baseline signal to estimate uplift"
    };
  }

  if (primaryUplift >= 0) {
    return {
      status: "healthy",
      note: "Optimizer uplift is neutral-to-positive on pooled broadcast outcomes"
    };
  }

  return {
    status: "underperforming",
    note: "Observed uplift is negative; retrain and compare against manual send cohorts"
  };
}

export async function GET() {
  try {
    const [sendTime, hygiene] = await Promise.all([
      prisma.modelVersion.findFirst({
        where: { modelName: "send_time_v1" },
        orderBy: { trainedAt: "desc" }
      }),
      prisma.modelVersion.findFirst({
        where: { modelName: "hygiene_v1" },
        orderBy: { trainedAt: "desc" }
      })
    ]);

    const [
      sendTimePredictions,
      hygienePredictions,
      sendTimeDecisionCountSinceTraining,
      sendTimeDecisionCountTotal,
      sendTimeDecisionStatsSinceTraining,
      broadcastMessages
    ] = await Promise.all([
      sendTime ? prisma.prediction.count({ where: { modelVersionId: sendTime.id } }) : 0,
      hygiene ? prisma.prediction.count({ where: { modelVersionId: hygiene.id } }) : 0,
      sendTime
        ? prisma.optimizerDecision.count({
            where: {
              createdAt: {
                gte: sendTime.trainedAt
              }
            }
          })
        : 0,
      prisma.optimizerDecision.count(),
      sendTime
        ? prisma.optimizerDecision.aggregate({
            where: {
              createdAt: {
                gte: sendTime.trainedAt
              }
            },
            _count: {
              _all: true
            },
            _avg: {
              score: true,
              baselineScore: true
            }
          })
        : null,
      prisma.message.findMany({
        where: {
          broadcastId: {
            not: null
          },
          sentAt: {
            not: null
          }
        },
        select: {
          broadcastId: true,
          scheduledSendAt: true,
          outcome: {
            select: {
              deliveredAt: true,
              clickedAt: true,
              metadata: true
            }
          }
        }
      })
    ]);

    const sendTimeSampleCount = sendTime ? readSampleCount(sendTime.metrics, "messages") : 0;
    const hygieneSampleCount = hygiene ? readSampleCount(hygiene.metrics, "contacts") : 0;

    let sentBroadcastMessages = 0;
    let optimizedSentMessages = 0;
    let optimizedDelivered = 0;
    let optimizedClicked = 0;
    let controlDelivered = 0;
    let controlClicked = 0;
    let baselineProbabilitySum = 0;
    let baselineSamples = 0;
    const optimizedBroadcastIds = new Set<string>();

    for (const message of broadcastMessages) {
      sentBroadcastMessages += 1;
      const optimized = Boolean(message.scheduledSendAt);
      if (optimized) {
        optimizedSentMessages += 1;
        if (message.broadcastId) {
          optimizedBroadcastIds.add(message.broadcastId);
        }
      }

      const delivered = Boolean(message.outcome?.deliveredAt);
      const clicked = Boolean(message.outcome?.clickedAt);

      if (optimized) {
        if (delivered) {
          optimizedDelivered += 1;
          if (clicked) {
            optimizedClicked += 1;
          }
        }

        const baselineProbability = readBaselineProbability(message.outcome?.metadata);
        if (baselineProbability !== null) {
          baselineProbabilitySum += baselineProbability;
          baselineSamples += 1;
        }
      } else if (delivered) {
        controlDelivered += 1;
        if (clicked) {
          controlClicked += 1;
        }
      }
    }

    const optimizedCtr = optimizedDelivered > 0 ? optimizedClicked / optimizedDelivered : 0;
    const controlCtr = controlDelivered > 0 ? controlClicked / controlDelivered : 0;
    const baselineCtr = baselineSamples > 0 ? baselineProbabilitySum / baselineSamples : null;
    const coverageRatio = sentBroadcastMessages > 0 ? optimizedSentMessages / sentBroadcastMessages : 0;

    const upliftVsControlPct =
      controlCtr > 0 ? Number((((optimizedCtr - controlCtr) / controlCtr) * 100).toFixed(2)) : null;
    const upliftVsBaselinePct =
      baselineCtr && baselineCtr > 0
        ? Number((((optimizedCtr - baselineCtr) / baselineCtr) * 100).toFixed(2))
        : null;

    const expectedScore = sendTimeDecisionStatsSinceTraining?._avg.score ?? null;
    const expectedBaseline = sendTimeDecisionStatsSinceTraining?._avg.baselineScore ?? null;
    const expectedUpliftPct =
      expectedScore !== null && expectedBaseline !== null && expectedBaseline > 0
        ? Number((((expectedScore - expectedBaseline) / expectedBaseline) * 100).toFixed(2))
        : null;

    const optimizerStatus = chooseOptimizerStatus({
      messageSamples: sendTimeSampleCount,
      optimizedDelivered,
      baselineSamples,
      upliftVsControlPct,
      upliftVsBaselinePct
    });

    return NextResponse.json({
      success: true,
      models: {
        sendTime: sendTime
          ? {
              id: sendTime.id,
              trainedAt: safeDate(sendTime.trainedAt),
              metrics: sendTime.metrics ?? null,
              metadata: sendTime.metadata ?? null,
              predictionCount: sendTimePredictions,
              sampleCount: sendTimeSampleCount,
              decisionCountSinceTraining: sendTimeDecisionCountSinceTraining,
              decisionCountTotal: sendTimeDecisionCountTotal,
              expectedScorePct: expectedScore !== null ? toPercent(expectedScore) : null,
              expectedBaselinePct: expectedBaseline !== null ? toPercent(expectedBaseline) : null,
              expectedUpliftPct,
              pooledPerformance: {
                pooledBroadcasts: optimizedBroadcastIds.size,
                sentMessages: sentBroadcastMessages,
                optimizedMessages: optimizedSentMessages,
                optimizationCoveragePct: Number((coverageRatio * 100).toFixed(2)),
                deliveredOptimized: optimizedDelivered,
                clickedOptimized: optimizedClicked,
                deliveredControl: controlDelivered,
                clickedControl: controlClicked,
                actualCtrPct: toPercent(optimizedCtr),
                controlCtrPct: toPercent(controlCtr),
                baselineCtrPct: baselineCtr !== null ? toPercent(baselineCtr) : null,
                baselineSamples,
                upliftVsControlPct,
                upliftVsBaselinePct,
                status: optimizerStatus.status,
                statusNote: optimizerStatus.note
              }
            }
          : null,
        hygiene: hygiene
          ? {
              id: hygiene.id,
              trainedAt: safeDate(hygiene.trainedAt),
              metrics: hygiene.metrics ?? null,
              metadata: hygiene.metadata ?? null,
              predictionCount: hygienePredictions,
              sampleCount: hygieneSampleCount
            }
          : null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load model summary";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 500 }
    );
  }
}

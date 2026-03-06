import { ContactStatus, Prisma } from "@prisma/client";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { predictHygieneRisk } from "./hygiene_model";
import { prisma } from "./prisma";

type SendTimeSample = {
  message_id: string;
  sent_at: string;
  hour_of_week: number;
  day_of_week: number;
  hour_of_day: number;
  is_weekend: number;
  propensity: number;
  lifecycle_stage: string;
  tag_count: number;
  clicked: number;
};

type SendTimeContactSample = {
  contact_id: string;
  propensity: number;
  lifecycle_stage: string;
  tag_count: number;
};

type HygieneSample = {
  contact_id: string;
  bias: number;
  days_since_event: number;
  days_since_send: number;
  delivered_not_clicked_ratio: number;
  propensity: number;
  hygiene_label: number;
};

type PythonModelResult = {
  status: "trained" | "no_data" | "single_class";
  algorithm: string;
  sample_count: number;
  positive_rate: number;
  metrics: Record<string, number | null>;
  raw_metrics?: Record<string, number | null>;
  artifact_relative_path: string | null;
  feature_names: string[];
  coefficients?: number[];
  base_rate?: number;
  calibration?: {
    method?: string;
  };
  threshold?: {
    threshold?: number;
    precision?: number;
    recall?: number;
    f1?: number;
  };
  contact_recommendations?: Array<{
    contact_id: string;
    recommended_hour: number;
    score: number;
    baseline_score: number;
  }>;
  warning?: string | null;
};

type PythonTrainingResult = {
  trained_at: string;
  send_time: PythonModelResult;
  hygiene: PythonModelResult;
};

export type TrainRealModelsSummary = {
  trainedAt: string;
  sendTime: {
    modelVersionId: string;
    sampleCount: number;
    positiveRate: number;
    status: string;
    algorithm: string;
    recommendationCount: number;
    threshold: number;
    warning: string | null;
  };
  hygiene: {
    modelVersionId: string;
    sampleCount: number;
    positiveRate: number;
    status: string;
    algorithm: string;
    predictionCount: number;
    threshold: number;
    warning: string | null;
  };
};

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

function hourOfWeek(date: Date): number {
  return date.getUTCDay() * 24 + date.getUTCHours();
}

function normalizeLifecycleStage(value: string | null): string {
  if (!value || !value.trim()) {
    return "unknown";
  }
  return value.trim().toLowerCase();
}

async function buildSendTimeDataset(): Promise<SendTimeSample[]> {
  const messages = await prisma.message.findMany({
    where: {
      sentAt: {
        not: null
      }
    },
    select: {
      id: true,
      sentAt: true,
      contact: {
        select: {
          propensity: true,
          lifecycleStage: true,
          tags: true
        }
      },
      outcome: {
        select: {
          clickedAt: true,
          deliveredAt: true,
          bouncedAt: true,
          complainedAt: true,
          failedAt: true,
          suppressedAt: true
        }
      }
    }
  });

  const rows: SendTimeSample[] = [];

  for (const message of messages) {
    if (!message.sentAt || !message.outcome) {
      continue;
    }

    const hasLabelSignal =
      Boolean(message.outcome.deliveredAt) ||
      Boolean(message.outcome.clickedAt) ||
      Boolean(message.outcome.bouncedAt) ||
      Boolean(message.outcome.complainedAt) ||
      Boolean(message.outcome.failedAt) ||
      Boolean(message.outcome.suppressedAt);

    if (!hasLabelSignal) {
      continue;
    }

    const how = hourOfWeek(message.sentAt);
    rows.push({
      message_id: message.id,
      sent_at: message.sentAt.toISOString(),
      hour_of_week: how,
      day_of_week: Math.floor(how / 24),
      hour_of_day: how % 24,
      is_weekend: message.sentAt.getUTCDay() === 0 || message.sentAt.getUTCDay() === 6 ? 1 : 0,
      propensity: toNumber(message.contact.propensity),
      lifecycle_stage: normalizeLifecycleStage(message.contact.lifecycleStage),
      tag_count: Array.isArray(message.contact.tags) ? message.contact.tags.length : 0,
      clicked: message.outcome.clickedAt ? 1 : 0
    });
  }

  return rows;
}

async function buildSendTimeContactDataset(): Promise<SendTimeContactSample[]> {
  const contacts = await prisma.contact.findMany({
    where: {
      status: ContactStatus.ACTIVE
    },
    select: {
      id: true,
      propensity: true,
      lifecycleStage: true,
      tags: true
    }
  });

  return contacts.map((contact) => ({
    contact_id: contact.id,
    propensity: toNumber(contact.propensity),
    lifecycle_stage: normalizeLifecycleStage(contact.lifecycleStage),
    tag_count: Array.isArray(contact.tags) ? contact.tags.length : 0
  }));
}

async function buildHygieneDataset(): Promise<HygieneSample[]> {
  const now = new Date();

  const contacts = await prisma.contact.findMany({
    select: {
      id: true,
      status: true,
      propensity: true,
      lastEventAt: true,
      lastMessageSentAt: true,
      messages: {
        select: {
          sentAt: true,
          outcome: {
            select: {
              clickedAt: true,
              bouncedAt: true,
              complainedAt: true
            }
          }
        }
      }
    }
  });

  const msPerDay = 24 * 60 * 60 * 1000;

  const rows: HygieneSample[] = contacts.map((contact) => {
    const totalSends = contact.messages.filter((message) => Boolean(message.sentAt)).length;
    const deliveredNotClicked = contact.messages.filter((message) => {
      if (!message.sentAt) {
        return false;
      }
      if (message.outcome?.bouncedAt || message.outcome?.complainedAt) {
        return false;
      }
      return !message.outcome?.clickedAt;
    }).length;

    const deliveredNotClickedRatio = totalSends > 0 ? deliveredNotClicked / totalSends : 0;

    const daysSinceEvent = contact.lastEventAt
      ? Math.max(0, (now.getTime() - contact.lastEventAt.getTime()) / msPerDay)
      : 180;
    const daysSinceSend = contact.lastMessageSentAt
      ? Math.max(0, (now.getTime() - contact.lastMessageSentAt.getTime()) / msPerDay)
      : 180;

    const normalizedDaysSinceEvent = Math.min(3, daysSinceEvent / 60);
    const normalizedDaysSinceSend = Math.min(3, daysSinceSend / 90);
    const normalizedPropensity = Math.max(0, Math.min(1, toNumber(contact.propensity)));

    const hasBounceOrComplaint =
      contact.status === ContactStatus.BOUNCED ||
      contact.status === ContactStatus.COMPLAINED ||
      contact.messages.some((message) => Boolean(message.outcome?.bouncedAt || message.outcome?.complainedAt));

    return {
      contact_id: contact.id,
      bias: 1,
      days_since_event: normalizedDaysSinceEvent,
      days_since_send: normalizedDaysSinceSend,
      delivered_not_clicked_ratio: Math.max(0, Math.min(1, deliveredNotClickedRatio)),
      propensity: normalizedPropensity,
      hygiene_label: hasBounceOrComplaint ? 1 : 0
    };
  });

  return rows;
}

function runPythonTrainer(payload: {
  send_time_samples: SendTimeSample[];
  send_time_contact_samples: SendTimeContactSample[];
  hygiene_samples: HygieneSample[];
}): Promise<PythonTrainingResult> {
  return new Promise(async (resolve, reject) => {
    const artifactsDir = path.join(process.cwd(), "artifacts", "models");
    await mkdir(artifactsDir, { recursive: true });

    const scriptPath = path.join(process.cwd(), "scripts", "ml", "train_real_models.py");
    const pythonExecutable = process.env.PYTHON_ML_EXECUTABLE?.trim() || "python";

    const child = spawn(pythonExecutable, [scriptPath, "--artifacts-dir", artifactsDir], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`Unable to start Python trainer: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Python trainer failed with code ${code}. ${stderr.trim() || "No stderr output"}`
          )
        );
        return;
      }

      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const finalLine = lines[lines.length - 1];

      if (!finalLine) {
        reject(new Error("Python trainer returned no JSON output"));
        return;
      }

      try {
        const parsed = JSON.parse(finalLine) as PythonTrainingResult;
        resolve(parsed);
      } catch (error) {
        reject(
          new Error(
            `Unable to parse trainer output JSON. ${(error as Error).message}. Raw output: ${stdout.slice(0, 400)}`
          )
        );
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function trainRealModels(): Promise<TrainRealModelsSummary> {
  const [sendDataset, sendContactDataset, hygieneDataset] = await Promise.all([
    buildSendTimeDataset(),
    buildSendTimeContactDataset(),
    buildHygieneDataset()
  ]);

  const trained = await runPythonTrainer({
    send_time_samples: sendDataset,
    send_time_contact_samples: sendContactDataset,
    hygiene_samples: hygieneDataset
  });

  const trainedAt = new Date(trained.trained_at);

  const sendTimeVersion = await prisma.modelVersion.create({
    data: {
      modelName: "send_time_real_v1",
      version: 1,
      trainedAt,
      metrics: {
        samples: {
          messages: trained.send_time.sample_count
        },
        evaluation: trained.send_time.metrics,
        rawEvaluation: trained.send_time.raw_metrics ?? null,
        positiveRate: trained.send_time.positive_rate,
        trainingStatus: trained.send_time.status,
        threshold: trained.send_time.threshold ?? null
      },
      metadata: {
        source: "python_sklearn",
        algorithm: trained.send_time.algorithm,
        featureNames: trained.send_time.feature_names,
        artifactRelativePath: trained.send_time.artifact_relative_path,
        calibration: trained.send_time.calibration ?? { method: "none" },
        thresholds: {
          classification: trained.send_time.threshold?.threshold ?? 0.5,
          precision: trained.send_time.threshold?.precision ?? null,
          recall: trained.send_time.threshold?.recall ?? null,
          f1: trained.send_time.threshold?.f1 ?? null
        },
        warning: trained.send_time.warning ?? null
      }
    }
  });

  const hygieneCoefficients = Array.isArray(trained.hygiene.coefficients)
    ? trained.hygiene.coefficients
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
    : [];
  const hygieneBaseRate =
    typeof trained.hygiene.base_rate === "number" && Number.isFinite(trained.hygiene.base_rate)
      ? trained.hygiene.base_rate
      : 0.05;

  const hygieneVersion = await prisma.modelVersion.create({
    data: {
      modelName: "hygiene_real_v1",
      version: 1,
      trainedAt,
      metrics: {
        samples: {
          contacts: trained.hygiene.sample_count
        },
        evaluation: trained.hygiene.metrics,
        rawEvaluation: trained.hygiene.raw_metrics ?? null,
        positiveRate: trained.hygiene.positive_rate,
        trainingStatus: trained.hygiene.status,
        threshold: trained.hygiene.threshold ?? null
      },
      metadata: {
        source: "python_sklearn",
        algorithm: trained.hygiene.algorithm,
        featureNames: trained.hygiene.feature_names,
        artifactRelativePath: trained.hygiene.artifact_relative_path,
        warning: trained.hygiene.warning ?? null,
        baseRate: hygieneBaseRate,
        weights: hygieneCoefficients,
        calibration: trained.hygiene.calibration ?? { method: "none" },
        thresholds: {
          classification: trained.hygiene.threshold?.threshold ?? 0.5,
          precision: trained.hygiene.threshold?.precision ?? null,
          recall: trained.hygiene.threshold?.recall ?? null,
          f1: trained.hygiene.threshold?.f1 ?? null
        }
      }
    }
  });

  const hygienePredictionRows: Prisma.PredictionCreateManyInput[] =
    hygieneCoefficients.length === 5
      ? hygieneDataset.map((sample) => {
          const features = [
            sample.bias,
            sample.days_since_event,
            sample.days_since_send,
            sample.delivered_not_clicked_ratio,
            sample.propensity
          ];
          return {
            modelVersionId: hygieneVersion.id,
            contactId: sample.contact_id,
            targetType: "hygiene_risk",
            score: predictHygieneRisk(hygieneCoefficients, features, hygieneBaseRate),
            payload: {
              source: "hygiene_real_v1",
              features,
              baseRate: hygieneBaseRate
            }
          };
        })
      : [];

  const sendTimeRecommendationRows: Prisma.PredictionCreateManyInput[] = [];
  if (Array.isArray(trained.send_time.contact_recommendations)) {
    for (const recommendation of trained.send_time.contact_recommendations) {
      const recommendedHour = Number(recommendation.recommended_hour);
      const score = Number(recommendation.score);
      const baselineScore = Number(recommendation.baseline_score);

      if (
        !recommendation.contact_id ||
        !Number.isInteger(recommendedHour) ||
        recommendedHour < 0 ||
        recommendedHour >= 7 * 24 ||
        !Number.isFinite(score) ||
        !Number.isFinite(baselineScore)
      ) {
        continue;
      }

      sendTimeRecommendationRows.push({
        modelVersionId: sendTimeVersion.id,
        contactId: recommendation.contact_id,
        targetType: "send_time_recommendation",
        score,
        payload: {
          sourceModel: "send_time_real_v1",
          recommendedHour,
          baselineScore,
          threshold: trained.send_time.threshold?.threshold ?? 0.5
        }
      });
    }
  }

  if (hygienePredictionRows.length > 0) {
    await prisma.prediction.createMany({ data: hygienePredictionRows });
  }

  if (sendTimeRecommendationRows.length > 0) {
    await prisma.prediction.createMany({ data: sendTimeRecommendationRows });
  }

  return {
    trainedAt: trainedAt.toISOString(),
    sendTime: {
      modelVersionId: sendTimeVersion.id,
      sampleCount: trained.send_time.sample_count,
      positiveRate: trained.send_time.positive_rate,
      status: trained.send_time.status,
      algorithm: trained.send_time.algorithm,
      recommendationCount: sendTimeRecommendationRows.length,
      threshold: trained.send_time.threshold?.threshold ?? 0.5,
      warning: trained.send_time.warning ?? null
    },
    hygiene: {
      modelVersionId: hygieneVersion.id,
      sampleCount: trained.hygiene.sample_count,
      positiveRate: trained.hygiene.positive_rate,
      status: trained.hygiene.status,
      algorithm: trained.hygiene.algorithm,
      predictionCount: hygienePredictionRows.length,
      threshold: trained.hygiene.threshold?.threshold ?? 0.5,
      warning: trained.hygiene.warning ?? null
    }
  };
}

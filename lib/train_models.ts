import { ContactStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { buildHygieneFeatures, predictHygieneRisk, sigmoid } from "./hygiene_model";

const HOURS_PER_WEEK = 7 * 24;
const SEGMENT_TAG_PREFIX = "segment=";

export type TrainModelsSummary = {
  sendTime?: {
    modelVersionId: string;
    messageSamples: number;
    segments: number;
  };
  hygiene?: {
    modelVersionId: string;
    contactsEvaluated: number;
    positiveLabels: number;
  };
};

type Histogram = {
  sends: number[];
  clicks: number[];
};

function createHistogram(): Histogram {
  return {
    sends: Array(HOURS_PER_WEEK).fill(0),
    clicks: Array(HOURS_PER_WEEK).fill(0)
  };
}

function hourOfWeek(date: Date): number {
  return date.getUTCDay() * 24 + date.getUTCHours();
}

function getSegmentTag(tags: string[]): string | null {
  const tag = tags.find((value) => value.startsWith(SEGMENT_TAG_PREFIX));
  return tag ? tag.split("=")[1] ?? null : null;
}

function computePrior(histogram: Histogram): number {
  const totalSends = histogram.sends.reduce((sum, value) => sum + value, 0);
  const totalClicks = histogram.clicks.reduce((sum, value) => sum + value, 0);
  if (!totalSends) {
    return 0.05;
  }
  return totalClicks / totalSends;
}

function histogramPayload(histogram: Histogram) {
  const totalSends = histogram.sends.reduce((sum, value) => sum + value, 0);
  const totalClicks = histogram.clicks.reduce((sum, value) => sum + value, 0);
  return {
    sends: histogram.sends,
    clicks: histogram.clicks,
    totalSends,
    totalClicks,
    prior: computePrior(histogram)
  };
}

export async function trainSendTimeModel(): Promise<TrainModelsSummary["sendTime"]> {
  const messages = await prisma.message.findMany({
    where: {
      sentAt: {
        not: null
      }
    },
    select: {
      sentAt: true,
      contact: {
        select: {
          tags: true
        }
      },
      outcome: {
        select: {
          clickedAt: true
        }
      }
    }
  });

  const global = createHistogram();
  const segments = new Map<string, Histogram>();

  messages.forEach((message) => {
    if (!message.sentAt) {
      return;
    }
    const hour = hourOfWeek(message.sentAt);
    global.sends[hour] += 1;
    if (message.outcome?.clickedAt) {
      global.clicks[hour] += 1;
    }

    const segment = getSegmentTag(message.contact.tags ?? []);
    if (segment) {
      let histogram = segments.get(segment);
      if (!histogram) {
        histogram = createHistogram();
        segments.set(segment, histogram);
      }
      histogram.sends[hour] += 1;
      if (message.outcome?.clickedAt) {
        histogram.clicks[hour] += 1;
      }
    }
  });

  const segmentPayload: Record<string, ReturnType<typeof histogramPayload>> = {};
  segments.forEach((value, key) => {
    segmentPayload[key] = histogramPayload(value);
  });

  const modelVersion = await prisma.modelVersion.create({
    data: {
      modelName: "send_time_v1",
      version: 1,
      metrics: {
        global: histogramPayload(global),
        segments: segmentPayload,
        samples: {
          messages: messages.length
        }
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        smoothingAlpha: 5
      }
    }
  });

  return {
    modelVersionId: modelVersion.id,
    messageSamples: messages.length,
    segments: segments.size
  };
}

function dotProduct(weights: number[], features: number[]): number {
  return weights.reduce((sum, weight, index) => sum + weight * (features[index] ?? 0), 0);
}

export async function trainHygieneModel(): Promise<TrainModelsSummary["hygiene"]> {
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

  if (contacts.length === 0) {
    return {
      modelVersionId: "",
      contactsEvaluated: 0,
      positiveLabels: 0
    };
  }

  const features: number[][] = [];
  const labels: number[] = [];
  const payloads: Array<{ contactId: string; vector: number[]; baseRate: number; deliveredRatio: number; propensity: number }> = [];
  let positiveLabels = 0;

  contacts.forEach((contact) => {
    const totalSends = contact.messages.filter((message) => message.sentAt).length;
    const deliveredNotClicked = contact.messages.filter((message) =>
      message.sentAt && !message.outcome?.clickedAt
    ).length;
    const deliveredRatio = totalSends > 0 ? deliveredNotClicked / totalSends : 0;

    const hasBounceOrComplaint =
      contact.status === ContactStatus.BOUNCED ||
      contact.status === ContactStatus.COMPLAINED ||
      contact.messages.some((message) => Boolean(message.outcome?.bouncedAt || message.outcome?.complainedAt));

    const label = hasBounceOrComplaint ? 1 : 0;
    if (label === 1) {
      positiveLabels += 1;
    }

    const vector = buildHygieneFeatures({
      lastEventAt: contact.lastEventAt,
      lastMessageSentAt: contact.lastMessageSentAt,
      propensity: contact.propensity ? Number(contact.propensity) : 0,
      deliveredNotClickedRatio: deliveredRatio,
      now
    }).features;

    features.push(vector);
    labels.push(label);
    payloads.push({
      contactId: contact.id,
      vector,
      baseRate: 0,
      deliveredRatio,
      propensity: contact.propensity ? Number(contact.propensity) : 0
    });
  });

  const baseRate = labels.length > 0 ? labels.reduce((sum, value) => sum + value, 0) / labels.length : 0.05;

  let weights = Array(features[0]?.length ?? 5).fill(0);

  if (positiveLabels > 0 && positiveLabels < labels.length) {
    const learningRate = 0.2;
    const iterations = 200;
    const l2 = 0.01;

    for (let iter = 0; iter < iterations; iter += 1) {
      const gradients = Array(weights.length).fill(0);
      for (let i = 0; i < features.length; i += 1) {
        const prediction = sigmoid(dotProduct(weights, features[i]));
        const error = prediction - labels[i];
        for (let j = 0; j < weights.length; j += 1) {
          gradients[j] += error * (features[i][j] ?? 0);
        }
      }
      for (let j = 0; j < weights.length; j += 1) {
        gradients[j] = gradients[j] / features.length + l2 * weights[j];
        weights[j] -= learningRate * gradients[j];
      }
    }
  }

  const modelVersion = await prisma.modelVersion.create({
    data: {
      modelName: "hygiene_v1",
      version: 1,
      metrics: {
        samples: {
          contacts: contacts.length,
          positiveLabels
        }
      },
      metadata: {
        generatedAt: now.toISOString(),
        baseRate,
        weights,
        featureNames: buildHygieneFeatures({
          lastEventAt: null,
          lastMessageSentAt: null,
          propensity: 0,
          deliveredNotClickedRatio: 0,
          now
        }).featureNames
      }
    }
  });

  const predictionRows: Prisma.PredictionCreateManyInput[] = payloads.map((payload) => {
    const score = predictHygieneRisk(weights, payload.vector, baseRate);
    return {
      modelVersionId: modelVersion.id,
      contactId: payload.contactId,
      targetType: "hygiene_risk",
      score,
      payload: {
        features: payload.vector,
        deliveredNotClickedRatio: payload.deliveredRatio,
        propensity: payload.propensity
      }
    };
  });

  if (predictionRows.length > 0) {
    await prisma.prediction.createMany({ data: predictionRows });
  }

  return {
    modelVersionId: modelVersion.id,
    contactsEvaluated: contacts.length,
    positiveLabels
  };
}

export async function trainModels(): Promise<TrainModelsSummary> {
  const [sendTime, hygiene] = await Promise.all([trainSendTimeModel(), trainHygieneModel()]);
  return { sendTime, hygiene };
}

export type HygieneFeatureInput = {
  lastEventAt: Date | null;
  lastMessageSentAt: Date | null;
  propensity: number | null;
  deliveredNotClickedRatio: number;
  now?: Date;
};

export type HygieneFeatureVector = {
  features: number[];
  featureNames: string[];
};

const FEATURE_NAMES = [
  "bias",
  "days_since_event",
  "days_since_send",
  "delivered_not_clicked_ratio",
  "propensity"
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildHygieneFeatures(input: HygieneFeatureInput): HygieneFeatureVector {
  const now = input.now ?? new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysSinceEvent = input.lastEventAt ? (now.getTime() - input.lastEventAt.getTime()) / msPerDay : 180;
  const daysSinceSend = input.lastMessageSentAt ? (now.getTime() - input.lastMessageSentAt.getTime()) / msPerDay : 180;
  const propensity = input.propensity ?? 0;

  const normalizedEvent = clamp(daysSinceEvent / 60, 0, 3);
  const normalizedSend = clamp(daysSinceSend / 90, 0, 3);
  const normalizedDeliveredNotClicked = clamp(input.deliveredNotClickedRatio, 0, 1);
  const normalizedPropensity = clamp(propensity, 0, 1);

  return {
    features: [
      1,
      normalizedEvent,
      normalizedSend,
      normalizedDeliveredNotClicked,
      normalizedPropensity
    ],
    featureNames: FEATURE_NAMES
  };
}

export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

export function predictHygieneRisk(weights: number[] | null, features: number[], baseRate: number): number {
  if (!weights || weights.length !== features.length) {
    return baseRate;
  }
  const dot = weights.reduce((sum, weight, index) => sum + weight * (features[index] ?? 0), 0);
  return sigmoid(dot);
}

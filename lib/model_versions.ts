import type { ModelVersion } from "@prisma/client";
import { prisma } from "./prisma";

async function getPreferredModelVersion(modelNames: string[]): Promise<ModelVersion | null> {
  const versions = await prisma.modelVersion.findMany({
    where: {
      modelName: {
        in: modelNames
      }
    },
    orderBy: {
      trainedAt: "desc"
    },
    take: 25
  });

  if (versions.length === 0) {
    return null;
  }

  for (const modelName of modelNames) {
    const latestForName = versions.find((version) => version.modelName === modelName);
    if (latestForName) {
      return latestForName;
    }
  }

  return versions[0] ?? null;
}

export async function getLatestHygieneModelVersion(): Promise<ModelVersion | null> {
  return getPreferredModelVersion(["hygiene_real_v1", "hygiene_v1"]);
}

export async function getLatestSendTimeModelVersion(): Promise<ModelVersion | null> {
  return getPreferredModelVersion(["send_time_real_v1", "send_time_v1"]);
}

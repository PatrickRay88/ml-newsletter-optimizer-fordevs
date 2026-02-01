import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function safeDate(value: Date | null) {
  return value ? value.toISOString() : null;
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

    const [sendTimePredictions, hygienePredictions] = await Promise.all([
      sendTime ? prisma.prediction.count({ where: { modelVersionId: sendTime.id } }) : 0,
      hygiene ? prisma.prediction.count({ where: { modelVersionId: hygiene.id } }) : 0
    ]);

    return NextResponse.json({
      success: true,
      models: {
        sendTime: sendTime
          ? {
              id: sendTime.id,
              trainedAt: safeDate(sendTime.trainedAt),
              metrics: sendTime.metrics ?? null,
              metadata: sendTime.metadata ?? null,
              predictionCount: sendTimePredictions
            }
          : null,
        hygiene: hygiene
          ? {
              id: hygiene.id,
              trainedAt: safeDate(hygiene.trainedAt),
              metrics: hygiene.metrics ?? null,
              metadata: hygiene.metadata ?? null,
              predictionCount: hygienePredictions
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

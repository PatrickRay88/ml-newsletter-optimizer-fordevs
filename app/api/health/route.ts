import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const startedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;

    const latencyMs = Date.now() - startedAt;
    return NextResponse.json({
      status: "ok",
      database: {
        connected: true,
        latencyMs
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected error establishing database connection";
    return NextResponse.json(
      {
        status: "error",
        database: {
          connected: false,
          message
        }
      },
      { status: 500 }
    );
  }
}

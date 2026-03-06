import { NextResponse } from "next/server";
import { trainRealModels } from "@/lib/train_real_models";

export async function POST() {
  try {
    const summary = await trainRealModels();
    return NextResponse.json({
      success: true,
      message: "Real ML models trained",
      summary
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to train real ML models";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { trainModels } from "@/lib/train_models";

export async function POST() {
  try {
    const summary = await trainModels();
    return NextResponse.json({
      success: true,
      message: "Models trained",
      summary
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to train models";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { recomputeSegmentMembership } from "@/lib/segments";

type RouteParams = {
  params: {
    id: string;
  };
};

export async function POST(_: Request, { params }: RouteParams) {
  if (!params.id) {
    return NextResponse.json(
      {
        success: false,
        message: "Segment id is required"
      },
      { status: 400 }
    );
  }

  try {
    const result = await recomputeSegmentMembership(params.id);
    return NextResponse.json({
      success: true,
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to recompute segment";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 400 }
    );
  }
}

import { NextResponse } from "next/server";
import { FlowStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, message: "Request body must be an object" }, { status: 400 });
    }

    const statusRaw = (body as { status?: unknown }).status;

    if (typeof statusRaw !== "string" || !(statusRaw in FlowStatus)) {
      return NextResponse.json({ success: false, message: "Valid flow status is required" }, { status: 400 });
    }

    const updated = await prisma.flow.update({
      where: { id: params.id },
      data: { status: statusRaw as FlowStatus },
      include: {
        steps: { orderBy: { order: "asc" } },
        template: { select: { id: true, name: true, subject: true } },
        segment: { select: { id: true, name: true } }
      }
    });

    return NextResponse.json({ success: true, flow: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update flow";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

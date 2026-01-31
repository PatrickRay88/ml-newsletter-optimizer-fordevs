import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type DecisionPayload = {
  id: string;
  contactId: string;
  contactEmail: string | null;
  contactTags: string[];
  recommendedHour: number;
  score: number;
  baselineScore: number;
  segment: string;
  throttled: boolean;
  recommendedAt: string | null;
  createdAt: string;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const contactId = url.searchParams.get("contactId") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const limitValue = Number(limitParam ?? "20");
    const take = Number.isFinite(limitValue) ? Math.min(Math.max(Math.floor(limitValue), 1), 100) : 20;

    const decisions = await prisma.optimizerDecision.findMany({
      where: contactId ? { contactId } : undefined,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        contact: {
          select: {
            email: true,
            tags: true
          }
        }
      }
    });

    const payload: DecisionPayload[] = decisions.map((decision) => {
      const rationale = (decision.rationale ?? {}) as Record<string, unknown>;
      const recommendedAt = typeof rationale.recommendedAt === "string" ? rationale.recommendedAt : null;
      const throttled = Boolean(rationale.throttled);
      const segment = typeof rationale.segment === "string" ? rationale.segment : "global";

      return {
        id: decision.id,
        contactId: decision.contactId,
        contactEmail: decision.contact?.email ?? null,
        contactTags: decision.contact?.tags ?? [],
        recommendedHour: decision.recommendedHour,
        score: decision.score,
        baselineScore: decision.baselineScore,
        segment,
        throttled,
        recommendedAt,
        createdAt: decision.createdAt.toISOString()
      };
    });

    return NextResponse.json({
      success: true,
      decisions: payload
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load optimizer decisions";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 500 }
    );
  }
}

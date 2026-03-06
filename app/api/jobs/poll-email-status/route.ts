import { NextResponse } from "next/server";
import { dispatchDueScheduledMessages } from "@/lib/broadcasts";
import { pollPendingMessages } from "@/lib/outcomes";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const batchSize = 250;
    const maxBatches = 8;

    const dispatchSummary = {
      checked: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      updatedBroadcasts: 0
    };

    const summary = {
      totalChecked: 0,
      delivered: 0,
      bounced: 0,
      failed: 0,
      complained: 0,
      suppressed: 0,
      unchanged: 0
    };

    let batchesProcessed = 0;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const dispatchBatch = await dispatchDueScheduledMessages(batchSize);
      const pollBatch = await pollPendingMessages(batchSize);

      dispatchSummary.checked += dispatchBatch.checked;
      dispatchSummary.sent += dispatchBatch.sent;
      dispatchSummary.failed += dispatchBatch.failed;
      dispatchSummary.skipped += dispatchBatch.skipped;
      dispatchSummary.updatedBroadcasts += dispatchBatch.updatedBroadcasts;

      summary.totalChecked += pollBatch.totalChecked;
      summary.delivered += pollBatch.delivered;
      summary.bounced += pollBatch.bounced;
      summary.failed += pollBatch.failed;
      summary.complained += pollBatch.complained;
      summary.suppressed += pollBatch.suppressed;
      summary.unchanged += pollBatch.unchanged;

      batchesProcessed += 1;

      if (dispatchBatch.checked === 0 && pollBatch.totalChecked === 0) {
        break;
      }
    }

    await prisma.event.create({
      data: {
        eventName: "job:poll-email-status",
        timestamp: new Date(),
        properties: {
          batchesProcessed,
          dispatchSummary,
          summary
        }
      }
    });

    return NextResponse.json({
      success: true,
      batchesProcessed,
      dispatchSummary,
      summary
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to poll email status";
    return NextResponse.json(
      {
        success: false,
        message
      },
      { status: 500 }
    );
  }
}

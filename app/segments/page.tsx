import { ContactStatus } from "@prisma/client";
import { getSegmentHeatmap, listSegments, type SegmentHeatmap } from "@/lib/segments";
import { listDistinctContactValues } from "@/lib/contacts";
import SegmentsClient from "./segments-client";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  const [segments, contactValues] = await Promise.all([
    listSegments(),
    listDistinctContactValues({ status: null, tag: null, timezone: null })
  ]);

  const heatmaps = await Promise.all(
    segments.map((segment) => getSegmentHeatmap(segment.id))
  );

  const heatmapById = heatmaps.reduce<Record<string, SegmentHeatmap>>((acc, heatmap) => {
    acc[heatmap.segmentId] = heatmap;
    return acc;
  }, {});

  return (
    <SegmentsClient
      segments={segments}
      statusOptions={Object.values(ContactStatus)}
      distinct={contactValues}
      heatmaps={heatmapById}
    />
  );
}

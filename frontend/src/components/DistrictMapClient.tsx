"use client";

import dynamic from "next/dynamic";
import type { FacilityView } from "@/lib/facility-view";

const DistrictMap = dynamic(
  () => import("./DistrictMap").then((m) => m.DistrictMap),
  {
    ssr: false,
    loading: () => (
      <div className="border border-hairline h-[420px] flex items-center justify-center text-ink-soft text-sm">
        Loading district map…
      </div>
    ),
  }
);

export function DistrictMapClient({
  facilities,
  height,
  onSelect,
}: {
  facilities: FacilityView[];
  height?: number;
  onSelect?: (facility: FacilityView) => void;
}) {
  return <DistrictMap facilities={facilities} height={height} onSelect={onSelect} />;
}

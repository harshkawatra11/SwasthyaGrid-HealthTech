"use client";

import { Select } from "@/components/ds/Select";
import { riskVar } from "@/lib/domain";
import { useEntityIndex } from "@/lib/entity-index";
import { DISTRICT_IDS, useScope } from "@/lib/scope";

export function ScopeSwitcher() {
  const { scope, setScope } = useScope();
  const index = useEntityIndex();
  const options = [
    { value: "all", label: `All Rajasthan (${DISTRICT_IDS.length} districts)` },
    ...index.districts.map((d) => ({
      value: d.id,
      label: d.shortName,
      dot: d.risk ? riskVar(d.risk) : undefined,
    })),
  ];
  return <Select value={scope} onValueChange={setScope} options={options} ariaLabel="District scope" />;
}

import { Suspense } from "react";
import { FacilityDirectory } from "@/components/facilities/FacilityDirectory";
import { Skeleton } from "@/components/ds/Skeleton";

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-[480px]" />}>
      <FacilityDirectory />
    </Suspense>
  );
}

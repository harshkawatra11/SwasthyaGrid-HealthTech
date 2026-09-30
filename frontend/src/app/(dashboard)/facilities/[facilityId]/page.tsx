import { FacilityCaseFile } from "@/components/facilities/FacilityCaseFile";

export default async function Page({ params }: { params: Promise<{ facilityId: string }> }) {
  const { facilityId } = await params;
  return <FacilityCaseFile facilityId={facilityId} />;
}

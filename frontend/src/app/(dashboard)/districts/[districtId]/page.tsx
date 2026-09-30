import { DistrictDetail } from "@/components/districts/DistrictDetail";

export default async function Page({ params }: { params: Promise<{ districtId: string }> }) {
  const { districtId } = await params;
  return <DistrictDetail districtId={districtId} />;
}

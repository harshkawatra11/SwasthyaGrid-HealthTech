import { TrackingView } from "@/components/supply/tracking/TrackingView";

export default async function Page({ params }: { params: Promise<{ shipmentId: string }> }) {
  const { shipmentId } = await params;
  return <TrackingView shipmentId={shipmentId} />;
}

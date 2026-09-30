import { STATUS_LABEL, statusVar, type ShipmentStatus } from "@/lib/domain";
import { Chip } from "./chip";

export function statusLabel(status: ShipmentStatus): string {
  return STATUS_LABEL[status];
}

export function StatusChip({
  status,
  size = "md",
  live,
}: {
  status: ShipmentStatus;
  size?: "sm" | "md";
  live?: boolean;
}) {
  const pulse = !!live && (status === "in_transit" || status === "delayed");
  return <Chip label={statusLabel(status)} color={statusVar(status)} size={size} pulse={pulse} />;
}

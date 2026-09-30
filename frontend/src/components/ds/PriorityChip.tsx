import { PRIORITY_LABEL, priorityVar, type Priority } from "@/lib/domain";
import { Chip } from "./chip";

export function PriorityChip({ priority, size = "md" }: { priority: Priority; size?: "sm" | "md" }) {
  return <Chip label={PRIORITY_LABEL[priority]} color={priorityVar(priority)} size={size} dot={false} />;
}

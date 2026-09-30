import { RISK_LABEL, riskVar, type RiskLevel } from "@/lib/domain";
import { Chip } from "./chip";

export function riskLabel(level: RiskLevel): string {
  return RISK_LABEL[level];
}

export function RiskChip({ level, size = "md" }: { level: RiskLevel; size?: "sm" | "md" }) {
  return <Chip label={riskLabel(level)} color={riskVar(level)} size={size} />;
}

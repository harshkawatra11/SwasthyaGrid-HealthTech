import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <Icon size={22} className="text-faint" aria-hidden />
      <p className="text-[13px] font-semibold text-text">{title}</p>
      {body && <p className="max-w-sm text-[12px] text-muted">{body}</p>}
      {action}
    </div>
  );
}

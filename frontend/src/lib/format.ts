const TZ = "Asia/Kolkata";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

export function fmtPct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

export function fmtKg(n: number): string {
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(n)} kg`;
}

export function fmtKm(n: number): string {
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(n)} km`;
}

export function fmtDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function fmtRelative(iso: string, nowIso: string): string {
  const diffMin = (new Date(iso).getTime() - new Date(nowIso).getTime()) / 60000;
  const abs = Math.round(Math.abs(diffMin));
  if (abs < 1) return "now";
  const body = abs < 60 ? `${abs} min` : abs < 48 * 60 ? fmtDuration(abs) : `${Math.round(abs / 1440)}d`;
  return diffMin > 0 ? `in ${body}` : `${body} ago`;
}

function istParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: get("day"), month: Number(get("month")), hour: get("hour"), minute: get("minute") };
}

/** IST "14:05" */
export function fmtClock(iso: string): string {
  const p = istParts(iso);
  return `${p.hour}:${p.minute}`;
}

/** IST "14:05:32", seconds included for a visibly live-ticking display. */
export function fmtClockSeconds(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}:${get("second")}`;
}

/** IST "26 Sep, 14:05" */
export function fmtDateTime(iso: string): string {
  const p = istParts(iso);
  return `${p.day} ${MONTHS[p.month - 1]}, ${p.hour}:${p.minute}`;
}

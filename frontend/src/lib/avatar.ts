export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "";
  if (words.length === 1) return first.toUpperCase();
  const last = Array.from(words[words.length - 1])[0] ?? "";
  return (first + last).toUpperCase();
}

/** Deterministic index 1..6 into the --series-* tokens. */
export function avatarSeries(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return (h % 6) + 1;
}

export function avatarColor(name: string): string {
  return `var(--series-${avatarSeries(name)})`;
}

import { avatarColor, initials } from "@/lib/avatar";
import { tint } from "@/lib/domain";

export function Avatar({ name, size = 32 }: { name: string; size?: 24 | 32 | 48 | 64 }) {
  const color = avatarColor(name);
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        backgroundColor: tint(color, 20),
        color,
      }}
    >
      {initials(name)}
    </span>
  );
}

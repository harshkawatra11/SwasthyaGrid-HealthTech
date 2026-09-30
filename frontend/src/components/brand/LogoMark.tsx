import Image from "next/image";

export function LogoMark({ size = 20 }: { size?: number }) {
  const width = Math.round((size * 412) / 352);
  return (
    <Image
      src="/brand/swasthyagrid-logo.png"
      alt="SwasthyaGrid"
      width={width}
      height={size}
      priority
      className="shrink-0"
    />
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-[16px] font-semibold leading-none">
      <LogoMark size={22} />
      <span>
        Swasthya<span className="text-brand">Grid</span>
      </span>
    </span>
  );
}

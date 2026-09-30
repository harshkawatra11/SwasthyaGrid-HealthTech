"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { Menu, Search } from "lucide-react";
import { LiveDot, type LiveState } from "@/components/ds/LiveDot";
import { Kbd } from "@/components/ds/Kbd";
import { ThemeToggle } from "@/components/ds/ThemeToggle";
import { useEntityIndex } from "@/lib/entity-index";
import { useLiveState } from "@/lib/live/LiveProvider";
import { OfflineBanner } from "@/components/ds/OfflineBanner";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { RoleSwitcher } from "./RoleSwitcher";
import { ScopeSwitcher } from "./ScopeSwitcher";
import { SimClockChip } from "./SimClockChip";
import { breadcrumbsFor } from "./nav-items";

const LIVE_LABEL: Record<LiveState, string> = { live: "Live", stale: "Stale", offline: "No stream" };

export function Topbar({
  onOpenPalette,
  onOpenNav,
  liveState: liveStateProp,
}: {
  onOpenPalette: () => void;
  onOpenNav: () => void;
  /** Overrides the live stream provider state (tests, storybook). */
  liveState?: LiveState;
}) {
  const pathname = usePathname();
  const live = useLiveState();
  const liveState = liveStateProp ?? live;
  const index = useEntityIndex();
  const crumbs = breadcrumbsFor(pathname, (seg) => {
    const name = index.facilityName(seg);
    return name !== seg ? name : index.districtName(seg);
  });

  return (
    <div className="sticky top-0 z-30">
    <OfflineBanner />
    <header className="relative flex h-14 items-center gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur lg:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-1 text-muted hover:bg-surface-3 hover:text-text lg:hidden"
      >
        <Menu size={16} />
      </button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[12px] text-muted xl:flex">
        {crumbs.map((c, i) => (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 && <span aria-hidden className="text-faint">/</span>}
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href} className="truncate hover:text-text">
                {c.label}
              </Link>
            ) : (
              <span className={i === crumbs.length - 1 ? "truncate text-text" : "truncate"}>{c.label}</span>
            )}
          </Fragment>
        ))}
      </nav>

      <div className="flex flex-1 justify-center">
        <ScopeSwitcher />
      </div>

      <div className="flex items-center gap-2">
        <SimClockChip />
        <span className="hidden items-center gap-1.5 text-[11px] text-muted lg:inline-flex" title={`Live stream: ${LIVE_LABEL[liveState]}`}>
          <LiveDot state={liveState} />
          {LIVE_LABEL[liveState]}
        </span>
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Search"
          className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 text-[12px] text-muted hover:bg-surface-3 hover:text-text"
        >
          <Search size={14} />
          <span className="hidden lg:inline">Search</span>
          <span className="hidden lg:inline-flex">
            <Kbd>Ctrl K</Kbd>
          </span>
        </button>
        <VoiceButton />
        <ThemeToggle />
        <div className="hidden sm:block">
          <RoleSwitcher />
        </div>
      </div>
    </header>
    </div>
  );
}

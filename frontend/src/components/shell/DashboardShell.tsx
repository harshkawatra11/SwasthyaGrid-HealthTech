"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { RoleProvider } from "@/lib/roleContext";
import { ScopeProvider } from "@/lib/scope";
import { ApiEntityIndexProvider } from "@/lib/api/entities";
import { ShellFeeds, SwrProvider } from "@/lib/api/shell-feeds";
import { Toaster } from "@/components/ds/Toaster";
import { Sheet, SheetContent } from "@/components/ds/overlays";
import { Sidebar, SidebarNav } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { PageTransition } from "./PageTransition";
import { ShellSkeleton } from "./ShellSkeleton";
import { VoiceDock } from "@/components/voice/VoiceDock";
import { VoiceSessionProvider } from "@/lib/voice/VoiceSessionProvider";

function Shell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const [navPath, setNavPath] = useState(pathname);
  // Close the mobile sheet when the route changes (state adjusted during render, not in an effect).
  if (navPath !== pathname) {
    setNavPath(pathname);
    setNavOpen(false);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <div className="flex min-h-screen bg-bg">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenPalette={() => setPaletteOpen(true)} onOpenNav={() => setNavOpen(true)} />
          <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-5 lg:px-6">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent title="SwasthyaGrid" side="left" className="lg:hidden">
          <div className="-m-4 flex h-full flex-col">
            <SidebarNav onNavigate={() => setNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toaster />
      <VoiceDock />
    </>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleProvider>
      <SwrProvider>
        <ApiEntityIndexProvider>
          {/* useSearchParams (inside ScopeProvider) requires a Suspense boundary or next build fails. */}
          <Suspense fallback={<ShellSkeleton />}>
            <ScopeProvider>
              <VoiceSessionProvider>
                <ShellFeeds>
                  <Shell>{children}</Shell>
                </ShellFeeds>
              </VoiceSessionProvider>
            </ScopeProvider>
          </Suspense>
        </ApiEntityIndexProvider>
      </SwrProvider>
    </RoleProvider>
  );
}

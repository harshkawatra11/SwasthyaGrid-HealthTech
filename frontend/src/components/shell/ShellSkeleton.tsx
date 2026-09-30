import { Wordmark } from "@/components/brand/LogoMark";
import { Skeleton } from "@/components/ds/Skeleton";

/** Suspense fallback for the shell: same frame as the real sidebar and topbar, so nothing shifts. */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-screen bg-bg" aria-busy="true">
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-border bg-bg-elevated lg:flex">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Wordmark />
        </div>
        <div className="space-y-2 p-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border px-4 lg:px-6">
          <Skeleton className="h-8 w-48" />
          <div className="flex-1" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-8" />
        </div>
        <main className="mx-auto w-full max-w-[1680px] flex-1 space-y-4 px-4 py-5 lg:px-6">
          <Skeleton className="h-7 w-64" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </main>
      </div>
    </div>
  );
}

"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useScope } from "@/lib/scope";
import { VoiceClient, type StartOptions, type VoiceState } from "./client";
import type { VoiceLanguage, VoiceMode } from "./protocol";

export type { VoiceState } from "./client";
export type { TranscriptLine, FactCard, VoiceLanguage, VoiceMode } from "./protocol";

export interface VoiceApi {
  state: VoiceState;
  start(opts?: StartOptions): Promise<void>;
  stop(): void;
  interrupt(): void;
  sendTyped(text: string): boolean;
  setMuted(muted: boolean): void;
  pttDown(): void;
  pttUp(): void;
  setLanguage(language: VoiceLanguage): void;
  setMode(mode: VoiceMode): void;
  setScope(districtId: string | null): void;
}

const VoiceContext = createContext<VoiceApi | null>(null);

/** One voice session for the whole dashboard, so moving between /voice and
 *  any other page keeps the call alive. */
export function VoiceSessionProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new VoiceClient());
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const { scope } = useScope();
  const districtId = scope === "all" ? null : scope;

  // Keep the server's scope in step with the topbar scope switcher.
  useEffect(() => {
    client.setScope(districtId);
  }, [client, districtId]);

  // End the call when the dashboard unmounts. stop() is idempotent and the client is reusable,
  // so React strict mode's unmount and remount in dev is harmless.
  useEffect(() => () => client.stop(), [client]);

  const api = useMemo<VoiceApi>(
    () => ({
      state,
      start: (opts) => client.start({ scope: districtId, ...opts }),
      stop: () => client.stop(),
      interrupt: () => client.interrupt(),
      sendTyped: (text) => client.sendTyped(text),
      setMuted: (m) => client.setMuted(m),
      pttDown: () => client.pttDown(),
      pttUp: () => client.pttUp(),
      setLanguage: (l) => client.setLanguage(l),
      setMode: (m) => client.setMode(m),
      setScope: (d) => client.setScope(d),
    }),
    [client, state, districtId],
  );

  return <VoiceContext.Provider value={api}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceApi {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice must be used within VoiceSessionProvider");
  return ctx;
}

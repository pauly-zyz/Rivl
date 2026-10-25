"use client";

import { useEffect, useRef, useState } from "react";

import { Avatar, PlayerTitle } from "./Avatar";
import { useNotificationPermission } from "@/lib/notify";
import type { Status } from "@/lib/duel";
import { shortAddress } from "@/lib/format";

/*
 * Alur "duel langsung" di halaman duel (tanpa transaksi tambahan):
 *   Open                 → ruang tunggu "Waiting for a rival…"
 *   Open → AwaitingReveal → layar MATCH FOUND (merah vs biru)
 *   AwaitingReveal → Settled/Draw → hitung mundur 3·2·1, BARU kemudian hasil ditampilkan
 * Hasil tetap hanya diambil dari chain (status Settled/Draw); hitung mundur hanya menunda tampilannya.
 */

const MATCH_FOUND_MS = 2_200;
const COUNTDOWN_FROM = 3;
const STEP_MS = 800;
/** Penantang yang baru bergabung (≤ 20 detik) tetap melihat MATCH FOUND walau halamannya baru dibuka. */
const FRESH_JOIN_SECONDS = 20;

export type MatchView = {
  /** Status yang ditampilkan: sama dengan chain, kecuali ditahan "AwaitingReveal" selama hitung mundur. */
  displayStatus: Status;
  overlay: "match" | "countdown" | null;
  count: number;
};

export function useMatchFlow(status: Status, joinedAt: bigint, now: number | undefined): MatchView {
  const prev = useRef<Status | undefined>(undefined);
  const [overlay, setOverlay] = useState<MatchView["overlay"]>(null);
  const [count, setCount] = useState(COUNTDOWN_FROM);
  const [holding, setHolding] = useState(false);

  useEffect(() => {
    const before = prev.current;
    prev.current = status;
    const final = status === "Settled" || status === "Draw";
    // Penantang yang baru bergabung dan membuka halaman ini setelahnya tetap mendapat MATCH FOUND.
    const freshJoin = before === undefined && now !== undefined && joinedAt > 0n && now - Number(joinedAt) <= FRESH_JOIN_SECONDS;
    const matchFound = (before === "Open" || freshJoin) && (status === "AwaitingReveal" || final);
    // Hasil final yang terjadi selagi halaman terbuka (atau tepat setelah join) → hitung mundur dulu.
    const countdown = final && (before === "AwaitingReveal" || matchFound);
    if (!matchFound && !countdown) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    let offset = 0;
    if (countdown) setHolding(true);
    if (matchFound) {
      setOverlay("match");
      offset = MATCH_FOUND_MS;
      if (!countdown) timers.push(setTimeout(() => setOverlay((o) => (o === "match" ? null : o)), MATCH_FOUND_MS));
    }
    if (countdown) {
      for (let i = 0; i < COUNTDOWN_FROM; i++) {
        timers.push(
          setTimeout(() => {
            setOverlay("countdown");
            setCount(COUNTDOWN_FROM - i);
          }, offset + i * STEP_MS),
        );
      }
      timers.push(
        setTimeout(() => {
          setOverlay(null);
          setHolding(false);
        }, offset + COUNTDOWN_FROM * STEP_MS),
      );
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return { displayStatus: holding ? "AwaitingReveal" : status, overlay, count };
}

/** Lapisan di atas panggung arena: MATCH FOUND atau hitung mundur. */
export function MatchOverlay({ view, creator, joiner }: { view: MatchView; creator: string; joiner?: string }) {
  if (!view.overlay) return null;
  return (
    <div
      className="absolute inset-0 z-10 grid place-items-center bg-bg/80 backdrop-blur-sm animate-fade-in"
      data-testid={view.overlay === "match" ? "match-found" : "match-countdown"}
      aria-live="assertive"
    >
      {view.overlay === "match" ? (
        <div className="flex flex-col items-center gap-5 px-4 text-center">
          <p className="eyebrow text-xs text-muted">Rival found</p>
          <div className="flex items-center gap-4 sm:gap-8">
            <Fighter address={creator} corner="red" label="Red corner" />
            <span className="font-display text-4xl font-black text-ink animate-pop sm:text-6xl [text-shadow:0_0_40px_rgb(229_72_77/0.5)]">
              VS
            </span>
            <Fighter address={joiner} corner="blue" label="Blue corner" />
          </div>
          <p className="font-display text-2xl font-black tracking-wide animate-pop sm:text-4xl">MATCH FOUND</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <p className="eyebrow text-xs text-muted">Result locked on chain</p>
          <span key={view.count} className="font-display text-8xl font-black animate-pop sm:text-9xl [text-shadow:0_0_60px_rgb(229_72_77/0.45)]">
            {view.count}
          </span>
        </div>
      )}
    </div>
  );
}

function Fighter({ address, corner, label }: { address?: string; corner: "red" | "blue"; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 animate-pop">
      <Avatar address={address} corner={corner} size={72} className="rounded-2xl" />
      <span className={`eyebrow text-[10px] ${corner === "red" ? "text-red" : "text-blue"}`}>{label}</span>
      <span className="font-mono text-xs text-ink/80">{address ? shortAddress(address) : "…"}</span>
      <PlayerTitle address={address} />
    </div>
  );
}

/** Ruang tunggu saat duel masih terbuka. */
export function WaitingRoom({ isCreator }: { isCreator: boolean }) {
  const { permission, request } = useNotificationPermission();
  return (
    <div className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-2 px-4" data-testid="waiting-room">
      <div className="inline-flex items-center gap-3 rounded-full border border-blue/40 bg-bg/80 px-4 py-2 backdrop-blur">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue" />
        </span>
        <span className="text-sm font-semibold">
          {isCreator ? "Waiting for a rival… share the link to fill the blue corner" : "Blue corner is open — join to duel"}
        </span>
      </div>
      {isCreator && permission === "default" && (
        <button
          type="button"
          onClick={request}
          className="rounded-full border border-line-strong bg-bg/70 px-3 py-1 text-xs font-semibold text-muted transition-colors hover:text-ink"
          data-testid="notify-rival"
        >
          🔔 Notify me when a rival joins
        </button>
      )}
      {isCreator && permission === "granted" && (
        <span className="text-xs text-muted">🔔 We&apos;ll notify you when a rival joins (keep this tab open).</span>
      )}
    </div>
  );
}

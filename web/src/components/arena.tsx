"use client";

import { MoveIcon } from "./icons";
import { SIDE_NAMES } from "@/lib/duel";
import { MOVE_NAMES } from "@/lib/suit";

/*
 * Animasi hasil (docs/spec.md 5.2): animasi tunggu berjalan sampai hasil ada di chain,
 * lalu berhenti di hasil sebenarnya. Komponen ini TIDAK PERNAH menebak hasil:
 * nilai `result` hanya diisi pemanggil dari getDuel() setelah status Settled/Draw.
 */

type Phase = "idle" | "waiting" | "result";

const corner = { creator: "text-red-bright border-red", joiner: "text-blue-bright border-blue" };
const glow = {
  creator: "shadow-[0_0_50px_-10px_var(--color-red),inset_0_0_30px_-10px_var(--color-red)]",
  joiner: "shadow-[0_0_50px_-10px_var(--color-blue),inset_0_0_30px_-10px_var(--color-blue)]",
};

export function CoinFlip({ phase, result, creatorSide }: { phase: Phase; result?: number; creatorSide: number }) {
  const sideOwner = (s: number) => (s === creatorSide ? corner.creator : corner.joiner);
  const motion =
    phase === "waiting" ? "animate-coin-spin" : phase === "result" ? (result === 0 ? "coin-land-heads" : "coin-land-tails") : "";

  return (
    <div className="flex flex-col items-center gap-4" data-testid="coin" data-phase={phase} data-result={phase === "result" ? result : ""}>
      <div className="[perspective:800px]">
        {/* key memastikan animasi mendarat diputar sekali saat hasil muncul */}
        <div key={`${phase}-${result}`} className={`coin relative h-40 w-40 sm:h-44 sm:w-44 ${motion}`}>
          <CoinFace label="H" className={sideOwner(0)} />
          <CoinFace label="T" className={`coin-face-back ${sideOwner(1)}`} />
        </div>
      </div>
      <p className="h-7 text-sm font-semibold text-muted" aria-live="polite">
        {phase === "waiting" ? (
          "Flipping… waiting for the creator to reveal"
        ) : phase === "result" ? (
          <span className="font-display text-xl font-black text-ink">{SIDE_NAMES[result!]}</span>
        ) : (
          ""
        )}
      </p>
    </div>
  );
}

function CoinFace({ label, className }: { label: string; className: string }) {
  return (
    <div className={`coin-face absolute inset-0 grid place-items-center rounded-full ${className}`}>
      <span className="font-display text-6xl font-black [text-shadow:0_2px_0_rgb(0_0_0/0.5)]">{label}</span>
    </div>
  );
}

export function DiceDuel({ phase, creatorRoll, joinerRoll }: { phase: Phase; creatorRoll?: number; joinerRoll?: number }) {
  const winner = phase === "result" && creatorRoll !== undefined && joinerRoll !== undefined
    ? creatorRoll === joinerRoll ? "draw" : creatorRoll > joinerRoll ? "creator" : "joiner"
    : undefined;

  return (
    <div className="flex flex-col items-center gap-4" data-testid="dice" data-phase={phase}>
      <div className="flex items-center gap-6">
        <Die value={phase === "result" ? creatorRoll : undefined} phase={phase} side="creator" win={winner === "creator"} />
        <span className="font-display text-lg font-black text-faint">VS</span>
        <Die value={phase === "result" ? joinerRoll : undefined} phase={phase} side="joiner" win={winner === "joiner"} />
      </div>
      <p className="h-6 text-sm font-semibold text-muted" aria-live="polite">
        {phase === "waiting" ? "Rolling… waiting for the creator to reveal" : winner === "draw" ? "Same number — draw" : ""}
      </p>
    </div>
  );
}

function Die({ value, phase, side, win }: { value?: number; phase: Phase; side: "creator" | "joiner"; win: boolean }) {
  return (
    <div
      data-testid={`die-${side}`}
      className={`tabular font-display grid h-24 w-24 place-items-center rounded-3xl border-2 bg-bg/70 text-4xl font-black sm:h-32 sm:w-32 sm:text-5xl ${corner[side]} ${
        phase === "waiting" ? "animate-shake" : phase === "result" ? "animate-pop" : ""
      } ${phase === "result" && win ? glow[side] : ""} ${phase === "result" && !win ? "opacity-45" : ""}`}
    >
      {/* Saat menunggu hanya "?" — tidak ada angka yang bisa disangka hasil. */}
      {value ?? (phase === "waiting" ? "?" : "–")}
    </div>
  );
}

export function SuitHands({
  phase,
  creatorMove,
  joinerMove,
}: {
  phase: Phase;
  /** Hanya diisi setelah pembuat me-reveal di chain. */
  creatorMove?: number;
  joinerMove?: number;
}) {
  return (
    <div className="flex flex-col items-center gap-4" data-testid="suit" data-phase={phase}>
      <div className="flex items-center gap-6">
        <Hand move={creatorMove} side="creator" phase={phase} />
        <span className="font-display text-lg font-black text-faint">VS</span>
        <Hand move={joinerMove} side="joiner" phase={phase} />
      </div>
      <p className="h-6 text-sm font-semibold text-muted" aria-live="polite">
        {phase === "waiting" ? "Waiting for the creator to reveal…" : ""}
      </p>
    </div>
  );
}

function Hand({ move, side, phase }: { move?: number; side: "creator" | "joiner"; phase: Phase }) {
  const shown = move !== undefined && move !== 0;
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`grid h-24 w-24 place-items-center rounded-full border-2 bg-bg/70 sm:h-32 sm:w-32 ${corner[side]} ${
          phase === "waiting" ? "animate-bob" : phase === "result" ? `animate-pop ${glow[side]}` : ""
        }`}
      >
        <MoveIcon move={shown ? move : undefined} className="h-12 w-12 sm:h-14 sm:w-14" />
      </div>
      <span className="eyebrow text-[10px] text-muted">
        {shown ? MOVE_NAMES[move!] ?? `Invalid (${move})` : side === "creator" ? "Hidden" : "No rival yet"}
      </span>
    </div>
  );
}

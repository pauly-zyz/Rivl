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

const corner = { creator: "text-red border-red", joiner: "text-blue border-blue" };

export function CoinFlip({ phase, result, creatorSide }: { phase: Phase; result?: number; creatorSide: number }) {
  const sideOwner = (s: number) => (s === creatorSide ? corner.creator : corner.joiner);
  const motion =
    phase === "waiting" ? "animate-coin-spin" : phase === "result" ? (result === 0 ? "coin-land-heads" : "coin-land-tails") : "";

  return (
    <div className="flex flex-col items-center gap-4" data-testid="coin" data-phase={phase} data-result={phase === "result" ? result : ""}>
      <div className="[perspective:800px]">
        {/* key memastikan animasi mendarat diputar sekali saat hasil muncul */}
        <div key={`${phase}-${result}`} className={`coin relative h-36 w-36 ${motion}`}>
          <CoinFace label="H" className={sideOwner(0)} />
          <CoinFace label="T" className={`coin-face-back ${sideOwner(1)}`} />
        </div>
      </div>
      <p className="h-6 text-sm font-semibold text-muted" aria-live="polite">
        {phase === "waiting" ? "Flipping… waiting for verifiable randomness" : phase === "result" ? `${SIDE_NAMES[result!]}` : ""}
      </p>
    </div>
  );
}

function CoinFace({ label, className }: { label: string; className: string }) {
  return (
    <div
      className={`coin-face absolute inset-0 grid place-items-center rounded-full border-[6px] bg-raised text-5xl font-black shadow-[inset_0_0_0_10px_#0a0b0d] ${className}`}
    >
      {label}
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
        <span className="text-sm font-black text-faint">VS</span>
        <Die value={phase === "result" ? joinerRoll : undefined} phase={phase} side="joiner" win={winner === "joiner"} />
      </div>
      <p className="h-6 text-sm font-semibold text-muted" aria-live="polite">
        {phase === "waiting" ? "Rolling… waiting for verifiable randomness" : winner === "draw" ? "Same number — draw" : ""}
      </p>
    </div>
  );
}

function Die({ value, phase, side, win }: { value?: number; phase: Phase; side: "creator" | "joiner"; win: boolean }) {
  return (
    <div
      data-testid={`die-${side}`}
      className={`tabular grid h-24 w-24 place-items-center rounded-2xl border-4 bg-raised text-4xl font-black sm:h-28 sm:w-28 ${corner[side]} ${
        phase === "waiting" ? "animate-shake" : phase === "result" ? "animate-pop" : ""
      } ${phase === "result" && !win ? "opacity-50" : ""}`}
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
        <span className="text-sm font-black text-faint">VS</span>
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
        className={`grid h-24 w-24 place-items-center rounded-full border-4 bg-raised sm:h-28 sm:w-28 ${corner[side]} ${
          phase === "waiting" ? "animate-bob" : phase === "result" ? "animate-pop" : ""
        }`}
      >
        <MoveIcon move={shown ? move : undefined} className="h-12 w-12" />
      </div>
      <span className="text-xs font-bold uppercase tracking-wider text-muted">
        {shown ? MOVE_NAMES[move!] ?? `Invalid (${move})` : side === "creator" ? "Hidden" : "No rival yet"}
      </span>
    </div>
  );
}

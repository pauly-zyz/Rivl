"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";

import { Avatar } from "@/components/Avatar";
import { ComingSoon } from "@/components/ComingSoon";
import { CreateDuelModal } from "@/components/CreateDuelModal";
import { GameIcon } from "@/components/icons";
import { GAME_LABEL, LiveResults, LiveTicker, OpenDuels } from "@/components/lobby";
import { BreakNotice, Button, SectionTitle } from "@/components/ui";
import { useArenaInfo } from "@/hooks/useArena";
import { useLimits } from "@/hooks/useLimits";
import { GAME_TAGLINE, GAMES, type Game } from "@/lib/duel";
import { formatAmount } from "@/lib/format";
import { useGlobalStats, useOpenDuels } from "@/lib/indexer";

const FAIRNESS: Record<Game, string> = {
  Coinflip: "Two-secret randomness",
  Dice: "Two-secret randomness",
  Suit: "Commit–reveal",
};

export default function LobbyPage() {
  const [creating, setCreating] = useState<{ game?: Game } | null>(null);
  const limits = useLimits();

  return (
    <div className="space-y-12 sm:space-y-16">
      <LiveTicker />

      <section className="relative grid items-center gap-10 pt-2 lg:grid-cols-[1.15fr_1fr] lg:pt-6">
        <div className="animate-rise">
          <p className="eyebrow flex items-center gap-2 text-muted">
            <span className="text-red">1v1</span> · On-chain · Provably fair
          </p>
          <h1 className="font-display mt-4 text-[2.6rem] font-black leading-[0.95] sm:text-6xl lg:text-7xl">
            Find your rival.
            <br />
            <span className="bg-gradient-to-r from-red-bright via-red to-red bg-clip-text text-transparent">Take the pot.</span>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
            Stake ETH or USDG against another player. Both stakes sit in the contract until the result is on chain —
            Rivl never plays against you.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {limits.onBreak ? (
              <div className="max-w-md">
                <BreakNotice until={limits.breakUntil} />
              </div>
            ) : (
              <Button size="lg" onClick={() => setCreating({})}>
                Create duel
              </Button>
            )}
            <Link
              href="/rules"
              className="inline-flex h-13 items-center rounded-xl px-4 font-display-condensed font-bold text-muted transition-colors hover:text-ink"
            >
              How it works →
            </Link>
          </div>
          <HeroStats />
        </div>
        <VersusPanel />
      </section>

      <section>
        <SectionTitle>Pick your game</SectionTitle>
        <div className="grid gap-4 md:grid-cols-3">
          {GAMES.map((g, i) => (
            <article
              key={g}
              className="card-lift edge-gradient group relative overflow-hidden rounded-2xl border border-line bg-surface/90 p-5 animate-rise"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-red/10 blur-3xl transition-opacity group-hover:opacity-100 md:opacity-60"
              />
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-14 w-14 place-items-center rounded-2xl border border-red/30 bg-red-deep text-red-bright">
                  <GameIcon game={g} className="h-7 w-7" />
                </span>
                <span className="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-muted">{FAIRNESS[g]}</span>
              </div>
              <h3 className="font-display mt-5 text-2xl font-black">{GAME_LABEL[g]}</h3>
              <p className="mt-2 min-h-12 text-sm text-muted">{GAME_TAGLINE[g]}</p>
              {!limits.onBreak && (
                <Button variant="secondary" className="mt-5 w-full" onClick={() => setCreating({ game: g })}>
                  Play {GAME_LABEL[g]}
                </Button>
              )}
            </article>
          ))}
        </div>
      </section>

      <div className="grid gap-12 lg:grid-cols-[1fr_340px]">
        <OpenDuels />
        <LiveResults />
      </div>

      <ComingSoon />

      <CreateDuelModal open={creating !== null} initialGame={creating?.game} onClose={() => setCreating(null)} />
    </div>
  );
}

/** Angka live dari indexer: duel terbuka, duel selesai, volume per token. */
function HeroStats() {
  const { data: stats } = useGlobalStats();
  const { data: open } = useOpenDuels({ sort: "newest" });
  const { tokens } = useArenaInfo();
  const decided = (stats?.byStatus.Settled ?? 0) + (stats?.byStatus.Draw ?? 0);

  const items: { label: string; value: string }[] = [
    { label: "Open now", value: open ? String(open.length) : "–" },
    { label: "Decided", value: stats ? decided.toLocaleString("en-US") : "–" },
    ...tokens.map((t) => {
      const row = stats?.byToken.find((b) => b.token.toLowerCase() === t.address.toLowerCase());
      return {
        label: `${t.symbol} vol.`,
        value: stats ? formatAmount(row?.volume ?? "0", t.decimals, t.isEth ? 3 : 0) : "–",
      };
    }),
  ];

  return (
    <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} className="bg-surface/95 px-4 py-3">
          <dt className="eyebrow truncate whitespace-nowrap text-[10px] text-faint">{s.label}</dt>
          <dd className="tabular font-display mt-1 truncate text-xl font-black">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Panel "VS": kamu di sudut merah, rival di sudut biru. Dekoratif, tanpa data duel. */
function VersusPanel() {
  const { address } = useAccount();
  const { feeBps, tokens } = useArenaInfo();
  const usdg = tokens.find((t) => !t.isEth);

  return (
    <div aria-hidden className="relative hidden animate-rise [animation-delay:120ms] lg:block">
      <div className="stage edge-gradient relative overflow-hidden rounded-3xl border border-line p-8">
        <div className="absolute inset-y-0 left-1/2 w-px bg-gradient-to-b from-transparent via-line-strong to-transparent" />
        <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <Corner label="Red corner" name={address ? "You" : "Creator"} address={address} corner="red" />
          <span className="font-display text-5xl font-black text-ink/90 [text-shadow:0_0_40px_rgb(229_72_77/0.35)]">VS</span>
          <Corner label="Blue corner" name="Your rival" corner="blue" />
        </div>
        <div className="relative mt-8 grid grid-cols-3 gap-2 text-center">
          <Stat value="2×" label="stake to winner" />
          <Stat value={feeBps !== undefined ? `${feeBps / 100}%` : "…"} label="fee, only on wins" />
          <Stat value="0%" label="fee on draws" />
        </div>
        {usdg && (
          <p className="relative mt-6 text-center text-xs text-faint">
            Example: 100 {usdg.symbol} vs 100 {usdg.symbol} → winner takes 195 {usdg.symbol}
          </p>
        )}
      </div>
    </div>
  );
}

function Corner({ label, name, address, corner }: { label: string; name: string; address?: string; corner: "red" | "blue" }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Avatar address={address} corner={corner} size={92} className="rounded-3xl" />
      <div>
        <div className={`eyebrow ${corner === "red" ? "text-red" : "text-blue"}`}>{label}</div>
        <div className="font-display mt-1 text-lg font-black">{name}</div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg/50 px-2 py-3">
      <div className="tabular font-display text-xl font-black">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  );
}

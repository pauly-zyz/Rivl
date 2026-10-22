"use client";

import { useState } from "react";

import { ComingSoon } from "@/components/ComingSoon";
import { CreateDuelModal } from "@/components/CreateDuelModal";
import { LiveResults, OpenDuels } from "@/components/lobby";
import { BreakNotice, Button } from "@/components/ui";
import { useLimits } from "@/hooks/useLimits";

export default function LobbyPage() {
  const [creating, setCreating] = useState(false);
  const limits = useLimits();

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface px-5 py-10 sm:px-10 sm:py-14">
        {/* Dua sudut arena */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-red" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-1.5 bg-blue" />
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-muted">1v1 · Coinflip · Dice Duel · Suit</p>
        <h1 className="mt-3 text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
          Find your rival.
          <br />
          <span className="text-red">Take the pot.</span>
        </h1>
        <p className="mt-4 max-w-md text-muted">
          Stake ETH or USDG against another player. Funds sit in the contract until the result is on chain. Rivl never
          plays against you.
        </p>
        {limits.onBreak ? (
          <div className="mt-6 max-w-md">
            <BreakNotice until={limits.breakUntil} />
          </div>
        ) : (
          <Button size="lg" className="mt-6" onClick={() => setCreating(true)}>
            Create duel
          </Button>
        )}
      </section>

      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <OpenDuels />
        <LiveResults />
      </div>

      <ComingSoon />

      <CreateDuelModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

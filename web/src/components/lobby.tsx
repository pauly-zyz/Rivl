"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";

import { GameIcon } from "./icons";
import { JoinDuelModal } from "./JoinDuelModal";
import { Badge, Button, Card, EmptyState, SectionTitle } from "./ui";
import { findToken, useArenaInfo, useNow, type TokenInfo } from "@/hooks/useArena";
import { GAMES, sameAddress, SIDE_NAMES, type Game } from "@/lib/duel";
import { formatAmount, formatDuration, parseAmount, shortAddress, timeAgo } from "@/lib/format";
import { useOpenDuels, useRecentResults, type IndexerDuel, type OpenDuelFilters } from "@/lib/indexer";

const GAME_LABEL: Record<Game, string> = { Coinflip: "Coinflip", Dice: "Dice Duel", Suit: "Suit" };

export function OpenDuels() {
  const { tokens } = useArenaInfo();
  const [game, setGame] = useState<Game | undefined>();
  const [tokenAddr, setTokenAddr] = useState<string>("");
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [sort, setSort] = useState<OpenDuelFilters["sort"]>("newest");
  const [joinId, setJoinId] = useState<bigint>();

  const token = findToken(tokens, tokenAddr);
  const filters: OpenDuelFilters = {
    game,
    sort,
    token: token?.address,
    minAmount: token ? parseAmount(minText, token.decimals) : undefined,
    maxAmount: token ? parseAmount(maxText, token.decimals) : undefined,
  };
  const { data, isLoading, error } = useOpenDuels(filters);

  return (
    <section>
      <SectionTitle aside={<span className="text-xs text-muted">{data ? `${data.length} open` : ""}</span>}>
        Open duels
      </SectionTitle>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Game">
          {[undefined, ...GAMES].map((g) => (
            <button
              key={g ?? "all"}
              role="tab"
              aria-selected={game === g}
              onClick={() => setGame(g)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold ${
                game === g ? "bg-raised text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {g ? GAME_LABEL[g] : "All games"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <select
            aria-label="Token"
            value={tokenAddr}
            onChange={(e) => setTokenAddr(e.target.value)}
            className="h-9 rounded-md border border-line bg-raised px-2 text-sm"
          >
            <option value="">All tokens</option>
            {tokens.map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>
          {token && (
            <>
              <input
                aria-label="Minimum stake"
                placeholder="Min"
                inputMode="decimal"
                value={minText}
                onChange={(e) => setMinText(e.target.value)}
                className="tabular h-9 w-20 rounded-md border border-line bg-raised px-2 text-sm"
              />
              <input
                aria-label="Maximum stake"
                placeholder="Max"
                inputMode="decimal"
                value={maxText}
                onChange={(e) => setMaxText(e.target.value)}
                className="tabular h-9 w-20 rounded-md border border-line bg-raised px-2 text-sm"
              />
            </>
          )}
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as OpenDuelFilters["sort"])}
            className="h-9 rounded-md border border-line bg-raised px-2 text-sm"
          >
            <option value="newest">Newest</option>
            <option value="amount">Biggest stake</option>
          </select>
        </div>
      </div>

      {error ? (
        <EmptyState>Can&apos;t reach the indexer right now. Retrying…</EmptyState>
      ) : isLoading ? (
        <EmptyState>Loading duels…</EmptyState>
      ) : !data?.length ? (
        <EmptyState>No open duels match. Create one and wait for a rival.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((d) => (
            <DuelCard key={d.id} duel={d} token={findToken(tokens, d.token)} onJoin={() => setJoinId(BigInt(d.id))} />
          ))}
        </div>
      )}

      {joinId !== undefined && <JoinDuelModal id={joinId} open onClose={() => setJoinId(undefined)} />}
    </section>
  );
}

function DuelCard({ duel, token, onJoin }: { duel: IndexerDuel; token?: TokenInfo; onJoin: () => void }) {
  const { address } = useAccount();
  const now = useNow();
  const mine = sameAddress(duel.creator, address);
  const left = now === undefined ? undefined : Number(duel.expiresAt) - now;

  return (
    <Card className="flex flex-col p-4" >
      <Link href={`/duel/${duel.id}`} className="group flex flex-1 flex-col" data-testid={`duel-card-${duel.id}`}>
        <div className="flex items-center gap-2 text-sm font-bold">
          <GameIcon game={duel.game} className="h-5 w-5 text-red" />
          {GAME_LABEL[duel.game]}
          <span className="text-faint">#{duel.id}</span>
          {mine && <span className="ml-auto"><Badge tone="red">Yours</Badge></span>}
        </div>
        <div className="tabular mt-3 text-2xl font-black tracking-tight">
          {token ? formatAmount(duel.amount, token.decimals) : "…"} <span className="text-base text-muted">{token?.symbol}</span>
        </div>
        <div className="mt-1 text-sm text-muted">
          by {shortAddress(duel.creator)}
          {duel.game === "Coinflip" && duel.creatorChoice !== null && <> · called {SIDE_NAMES[duel.creatorChoice]}</>}
        </div>
      </Link>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="tabular text-xs text-muted">{left === undefined ? "" : left > 0 ? `${formatDuration(left)} left` : "Expired"}</span>
        {mine ? (
          <Link href={`/duel/${duel.id}`} className="text-sm font-semibold text-muted hover:text-ink">
            View
          </Link>
        ) : (
          <Button variant="blue" size="sm" onClick={onJoin} disabled={left !== undefined && left <= 0}>
            Join
          </Button>
        )}
      </div>
    </Card>
  );
}

export function LiveResults() {
  const { data, error } = useRecentResults();
  const { tokens } = useArenaInfo();
  const now = useNow();

  return (
    <section>
      <SectionTitle>Live results</SectionTitle>
      <Card className="divide-y divide-line">
        {error ? (
          <p className="p-4 text-sm text-muted">Can&apos;t reach the indexer right now.</p>
        ) : !data?.length ? (
          <p className="p-4 text-sm text-muted">No finished duels yet.</p>
        ) : (
          data.map((d) => {
            const token = findToken(tokens, d.token);
            return (
              <Link key={d.id} href={`/duel/${d.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-raised">
                <GameIcon game={d.game} className="h-5 w-5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  {d.status === "Draw" ? (
                    <span className="text-muted">Draw · stakes returned</span>
                  ) : (
                    <span>
                      <b>{shortAddress(d.winner)}</b> <span className="text-muted">won</span>{" "}
                      <b className="tabular">
                        {token && d.payout ? formatAmount(d.payout, token.decimals) : "…"} {token?.symbol}
                      </b>
                    </span>
                  )}
                </div>
                <span className="tabular shrink-0 text-xs text-faint">
                  {now !== undefined && d.settledAt ? timeAgo(now - Number(d.settledAt)) : ""}
                </span>
              </Link>
            );
          })
        )}
      </Card>
    </section>
  );
}

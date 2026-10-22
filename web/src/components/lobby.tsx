"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";

import { Avatar } from "./Avatar";
import { GameIcon } from "./icons";
import { JoinDuelModal } from "./JoinDuelModal";
import { Badge, Button, EmptyState, SectionTitle } from "./ui";
import { findToken, useArenaInfo, useNow, type TokenInfo } from "@/hooks/useArena";
import { useLimits } from "@/hooks/useLimits";
import { GAMES, sameAddress, SIDE_NAMES, type Game } from "@/lib/duel";
import { formatAmount, formatDuration, parseAmount, shortAddress, timeAgo } from "@/lib/format";
import { useOpenDuels, useRecentResults, type IndexerDuel, type OpenDuelFilters } from "@/lib/indexer";

export const GAME_LABEL: Record<Game, string> = { Coinflip: "Coinflip", Dice: "Dice Duel", Suit: "Suit" };

const control =
  "h-9 rounded-lg border border-line bg-raised/80 px-2.5 text-sm text-ink outline-none transition-colors hover:border-line-strong focus:border-muted";

export function OpenDuels() {
  const { tokens } = useArenaInfo();
  const [game, setGame] = useState<Game | undefined>();
  const [tokenAddr, setTokenAddr] = useState<string>("");
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [sort, setSort] = useState<OpenDuelFilters["sort"]>("newest");
  const [joinId, setJoinId] = useState<bigint>();
  const { onBreak } = useLimits();

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
    <section id="open-duels">
      <SectionTitle
        aside={
          data && (
            <span className="tabular rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-semibold text-muted">
              {data.length} open
            </span>
          )
        }
      >
        Open duels
      </SectionTitle>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface/80 p-1" role="tablist" aria-label="Game">
          {[undefined, ...GAMES].map((g) => (
            <button
              key={g ?? "all"}
              role="tab"
              aria-selected={game === g}
              onClick={() => setGame(g)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                game === g ? "bg-raised text-ink shadow-[inset_0_-2px_0_var(--color-red)]" : "text-muted hover:text-ink"
              }`}
            >
              {g ? GAME_LABEL[g] : "All games"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <select aria-label="Token" value={tokenAddr} onChange={(e) => setTokenAddr(e.target.value)} className={control}>
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
                className={`tabular w-20 ${control}`}
              />
              <input
                aria-label="Maximum stake"
                placeholder="Max"
                inputMode="decimal"
                value={maxText}
                onChange={(e) => setMaxText(e.target.value)}
                className={`tabular w-20 ${control}`}
              />
            </>
          )}
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as OpenDuelFilters["sort"])}
            className={control}
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
        <EmptyState>
          <span className="font-display block text-lg font-black text-ink">The ring is empty.</span>
          <span className="mt-1 block">Create a duel and wait for a rival to step in.</span>
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.map((d, i) => (
            <DuelCard
              key={d.id}
              duel={d}
              index={i}
              token={findToken(tokens, d.token)}
              onBreak={onBreak}
              onJoin={() => setJoinId(BigInt(d.id))}
            />
          ))}
        </div>
      )}

      {joinId !== undefined && <JoinDuelModal id={joinId} open onClose={() => setJoinId(undefined)} />}
    </section>
  );
}

/** Kartu duel bergaya "fight card": pembuat (sudut merah) vs kursi kosong (sudut biru). */
function DuelCard({
  duel,
  token,
  onJoin,
  onBreak,
  index,
}: {
  duel: IndexerDuel;
  token?: TokenInfo;
  onJoin: () => void;
  onBreak: boolean;
  index: number;
}) {
  const { address } = useAccount();
  const now = useNow();
  const mine = sameAddress(duel.creator, address);
  const left = now === undefined ? undefined : Number(duel.expiresAt) - now;
  const total = Number(duel.expiresAt) - Number(duel.createdAt);
  const pct = left === undefined || total <= 0 ? 100 : Math.max(0, Math.min(100, (left / total) * 100));
  const detail =
    duel.game === "Coinflip" && duel.creatorChoice !== null
      ? `Called ${SIDE_NAMES[duel.creatorChoice]}`
      : duel.game === "Suit"
        ? "Move hidden"
        : "Roll 1–100";

  return (
    <div
      className="card-lift edge-gradient group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface/90 animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Link href={`/duel/${duel.id}`} className="flex flex-1 flex-col p-4" data-testid={`duel-card-${duel.id}`}>
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-red-deep text-red">
            <GameIcon game={duel.game} className="h-4 w-4" />
          </span>
          <span className="font-display-condensed text-sm font-bold">{GAME_LABEL[duel.game]}</span>
          <span className="tabular text-xs text-faint">#{duel.id}</span>
          {mine && (
            <span className="ml-auto">
              <Badge tone="red">Yours</Badge>
            </span>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2.5">
          <Avatar address={duel.creator} corner="red" size={40} />
          <span className="font-display text-[10px] font-black text-faint">VS</span>
          <Avatar corner="blue" size={40} />
          <div className="ml-1 min-w-0 text-xs leading-snug text-muted">
            <div className="truncate font-mono text-ink/90">{shortAddress(duel.creator)}</div>
            <div className="truncate">{detail}</div>
          </div>
        </div>

        <div className="mt-4 flex items-baseline gap-1.5">
          <span className="tabular font-display truncate text-3xl font-black leading-none">
            {token ? formatAmount(duel.amount, token.decimals) : "…"}
          </span>
          <span className="text-sm font-bold text-muted">{token?.symbol}</span>
          <span className="ml-auto text-[11px] text-faint">each</span>
        </div>
      </Link>

      <div className="border-t border-line/70 bg-bg/40 px-4 py-3">
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
          <div className="h-full rounded-full bg-gradient-to-r from-blue to-blue-bright" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="tabular text-xs text-muted">
            {left === undefined ? "" : left > 0 ? `${formatDuration(left)} left` : "Expired"}
          </span>
          {mine || onBreak ? (
            <Link href={`/duel/${duel.id}`} className="text-sm font-semibold text-muted hover:text-ink">
              View
            </Link>
          ) : (
            <Button variant="blue" size="sm" onClick={onJoin} disabled={left !== undefined && left <= 0}>
              Join
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function LiveResults() {
  const { data, error } = useRecentResults();
  const { tokens } = useArenaInfo();
  const now = useNow();

  return (
    <section>
      <SectionTitle>Live results</SectionTitle>
      <div className="edge-gradient overflow-hidden rounded-2xl border border-line bg-surface/90">
        {error ? (
          <p className="p-4 text-sm text-muted">Can&apos;t reach the indexer right now.</p>
        ) : !data?.length ? (
          <p className="p-4 text-sm text-muted">No finished duels yet.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {data.map((d) => {
              const token = findToken(tokens, d.token);
              const creatorWon = sameAddress(d.winner, d.creator);
              return (
                <li key={d.id}>
                  <Link href={`/duel/${d.id}`} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-raised/70">
                    {d.status === "Draw" ? (
                      <Avatar corner="neutral" address={d.creator} size={30} />
                    ) : (
                      <Avatar address={d.winner} corner={creatorWon ? "red" : "blue"} size={30} />
                    )}
                    <div className="min-w-0 flex-1">
                      {d.status === "Draw" ? (
                        <span className="text-muted">Draw · stakes returned</span>
                      ) : (
                        <span>
                          <span className="font-mono text-xs">{shortAddress(d.winner)}</span>{" "}
                          <span className="text-muted">won</span>{" "}
                          <b className="tabular">
                            {token && d.payout ? formatAmount(d.payout, token.decimals) : "…"} {token?.symbol}
                          </b>
                        </span>
                      )}
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-faint">
                        <GameIcon game={d.game} className="h-3 w-3" /> {GAME_LABEL[d.game]}
                      </span>
                    </div>
                    <span className="tabular shrink-0 text-xs text-faint">
                      {now !== undefined && d.settledAt ? timeAgo(now - Number(d.settledAt)) : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Pita hasil terbaru yang bergulir pelan. Berhenti saat di-hover; statis jika reduced motion. */
export function LiveTicker() {
  const { data } = useRecentResults();
  const { tokens } = useArenaInfo();
  const items = (data ?? []).filter((d) => d.status === "Settled").slice(0, 12);
  if (items.length < 3) return null;

  const row = items.map((d) => {
    const token = findToken(tokens, d.token);
    return (
      <span key={d.id} className="flex shrink-0 items-center gap-2 px-5 text-xs">
        <GameIcon game={d.game} className="h-3.5 w-3.5 text-faint" />
        <span className="font-mono text-ink/90">{shortAddress(d.winner)}</span>
        <span className="text-faint">took</span>
        <b className="tabular text-ink">
          {token && d.payout ? formatAmount(d.payout, token.decimals, 4) : "…"} {token?.symbol}
        </b>
        <span className="text-line-strong">/</span>
      </span>
    );
  });

  return (
    <div className="ticker relative -mx-4 flex items-center overflow-hidden border-y border-line/70 bg-surface/60 py-2 sm:mx-0 sm:rounded-xl sm:border" aria-label="Recent winners">
      <span className="eyebrow z-10 flex shrink-0 items-center gap-2 bg-surface px-4 text-red">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red" />
        Live
      </span>
      <div className="relative flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <div className="ticker-track flex w-max">
          <div className="flex">{row}</div>
          <div className="flex" aria-hidden>
            {row}
          </div>
        </div>
      </div>
    </div>
  );
}

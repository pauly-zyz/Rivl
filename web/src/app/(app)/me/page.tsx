"use client";

import { duelArenaAbi } from "@rivl/contracts/abi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useRef, useState } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { Avatar } from "@/components/Avatar";
import { GameIcon } from "@/components/icons";
import { Badge, BreakNotice, Button, Card, EmptyState, FieldError, SectionTitle, TxNotice } from "@/components/ui";
import { findToken, useArenaInfo, useNow, type TokenInfo } from "@/hooks/useArena";
import { useDailyAllowance, useLimits } from "@/hooks/useLimits";
import { useSuitSecrets } from "@/hooks/useSuitSecrets";
import { useTx } from "@/hooks/useTx";
import { appConfig } from "@/lib/config";
import { sameAddress, STATUS_LABEL } from "@/lib/duel";
import { formatAmount, formatDuration, parseAmount, shortAddress } from "@/lib/format";
import { BREAK_OPTIONS } from "@/lib/limits";
import { usePendingReveals, usePlayerDuels, usePlayerStats, type IndexerDuel } from "@/lib/indexer";

export default function MePage() {
  const { address } = useAccount();
  if (!address) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="font-display text-3xl font-black">My duels</h1>
        <p className="mt-3 text-muted">Connect your wallet to see your duels, claim winnings and back up your Suit moves.</p>
        <div className="mt-6 flex justify-center">
          <ConnectButton />
        </div>
      </div>
    );
  }
  return <MyDuels address={address} />;
}

function MyDuels({ address }: { address: Address }) {
  return (
    <div className="space-y-8">
      <header className="flex items-center gap-4 animate-rise">
        <Avatar address={address} corner="red" size={60} className="rounded-2xl" />
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-black sm:text-4xl">My duels</h1>
          <p className="mt-1 truncate font-mono text-sm text-muted">{address}</p>
        </div>
      </header>
      <PendingReveals address={address} />
      <div className="grid gap-8 lg:grid-cols-2">
        <Claimable address={address} />
        <SuitBackup address={address} />
      </div>
      <PersonalLimits address={address} />
      <Stats address={address} />
      <History address={address} />
    </div>
  );
}

function PendingReveals({ address }: { address: Address }) {
  const { data } = usePendingReveals(address);
  const { find } = useSuitSecrets();
  const now = useNow();
  if (!data?.length) return null;

  return (
    <section className="rounded-2xl border-2 border-red bg-red-deep p-4 sm:p-5" data-testid="pending-reveals">
      <h2 className="text-lg font-black">You need to reveal</h2>
      <p className="mt-1 text-sm text-ink/80">Your rival has joined. Reveal before the deadline or they win the pot.</p>
      <ul className="mt-4 space-y-2">
        {data.map((d) => {
          const left = now === undefined ? undefined : Number(d.deadline) - now;
          const hasSecret = !!find(d.commit);
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-bg/60 px-3 py-2">
              <span className="font-bold">Suit #{d.id}</span>
              <span className="tabular text-sm text-muted">
                {left === undefined ? "…" : left > 0 ? `${formatDuration(left)} left` : "Window closed"}
              </span>
              {!hasSecret && <Badge tone="red">Move not in this browser</Badge>}
              <Link href={`/duel/${d.id}`} className="ml-auto rounded-lg bg-red px-3 py-1.5 text-sm font-bold text-white">
                {hasSecret && (left ?? 1) > 0 ? "Reveal now" : "Open"}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Claimable({ address }: { address: Address }) {
  const { tokens } = useArenaInfo();
  const tx = useTx();
  const busyLabel = tx.busy && "label" in tx.state ? tx.state.label : undefined;

  return (
    <section>
      <SectionTitle>Claimable</SectionTitle>
      <Card className="divide-y divide-line">
        {tokens.map((t) => (
          <ClaimRow key={t.address} token={t} address={address} tx={tx} busy={busyLabel === `Claim ${t.symbol}`} />
        ))}
      </Card>
      <div className="mt-2">
        <TxNotice state={tx.state} />
      </div>
      <p className="mt-2 text-xs text-muted">Winnings, draws, refunds and cancelled stakes collect here until you claim them.</p>
    </section>
  );
}

function ClaimRow({ token, address, tx, busy }: { token: TokenInfo; address: Address; tx: ReturnType<typeof useTx>; busy: boolean }) {
  const { arena } = appConfig();
  const { data } = useReadContract({
    address: arena,
    abi: duelArenaAbi,
    functionName: "claimable",
    args: [address, token.address],
    query: { refetchInterval: 3_000 },
  });
  const amount = data ?? 0n;

  return (
    <div className="flex items-center gap-3 px-4 py-3" data-testid={`claimable-${token.symbol}`}>
      <span className="w-14 font-bold">{token.symbol}</span>
      <span className="tabular flex-1 text-lg font-black">{formatAmount(amount, token.decimals)}</span>
      <Button
        size="sm"
        disabled={amount === 0n}
        loading={busy}
        onClick={() =>
          tx.send(`Claim ${token.symbol}`, { address: arena, abi: duelArenaAbi, functionName: "withdraw", args: [token.address] }).catch(() => {})
        }
      >
        Claim
      </Button>
    </div>
  );
}

function SuitBackup({ address }: { address: Address }) {
  const { secrets, available, backup, restore } = useSuitSecrets();
  const { arena, chain } = appConfig();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  const mine = secrets.filter((s) => sameAddress(s.creator, address) && s.chainId === chain.id && sameAddress(s.arena, arena));

  function download() {
    const blob = new Blob([backup()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rivl-suit-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(file: File) {
    try {
      const { restored, invalid } = restore(await file.text());
      setMessage({
        tone: invalid ? "error" : "ok",
        text: `Restored ${restored} move${restored === 1 ? "" : "s"}.${invalid ? ` Skipped ${invalid} invalid entr${invalid === 1 ? "y" : "ies"}.` : ""}`,
      });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Could not read this file." });
    }
  }

  return (
    <section id="backup">
      <SectionTitle>Suit moves backup</SectionTitle>
      <Card className="p-4">
        <p className="text-sm text-ink/90">
          Your hidden Suit moves live only in this browser. If you clear it or switch devices without a backup, you
          can&apos;t reveal — and you lose those duels.
        </p>
        <p className="tabular mt-3 text-sm text-muted" data-testid="secret-count">
          {mine.length} move{mine.length === 1 ? "" : "s"} saved for this wallet
          {secrets.length !== mine.length ? ` (${secrets.length} total in this browser)` : ""}.
        </p>
        {!available && <p className="mt-2 text-sm text-red">This browser blocks local storage. Suit moves can&apos;t be saved here.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={download} disabled={secrets.length === 0}>
            Back up (download)
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={!available}>
            Restore (upload)
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="restore-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </div>
        {message && <p className={`mt-3 text-sm ${message.tone === "ok" ? "text-ink" : "text-red"}`}>{message.text}</p>}
      </Card>
    </section>
  );
}

function Stats({ address }: { address: Address }) {
  const { data } = usePlayerStats(address);
  const { tokens } = useArenaInfo();
  if (!data) return null;

  return (
    <section>
      <SectionTitle>Stats</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Wins" value={data.wins} />
        <Stat label="Losses" value={data.losses} />
        <Stat label="Draws" value={data.draws} />
      </div>
      {data.byToken.length > 0 && (
        <Card className="mt-3 divide-y divide-line">
          {data.byToken.map((t) => {
            const token = findToken(tokens, t.token);
            if (!token) return null;
            const net = BigInt(t.net);
            return (
              <div key={t.token} className="tabular flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-sm">
                <span className="w-14 font-bold">{token.symbol}</span>
                <span className="text-muted">
                  Volume <b className="text-ink">{formatAmount(t.volume, token.decimals)}</b>
                </span>
                <span className="text-muted">
                  Net{" "}
                  <b className={net < 0n ? "text-red" : "text-ink"}>
                    {net < 0n ? "−" : "+"}
                    {formatAmount(net < 0n ? -net : net, token.decimals)}
                  </b>
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4 text-center">
      <div className="tabular font-display text-4xl font-black">{value}</div>
      <div className="eyebrow mt-1 text-[10px] text-muted">{label}</div>
    </Card>
  );
}

function History({ address }: { address: Address }) {
  const { data, error } = usePlayerDuels(address);
  const { tokens } = useArenaInfo();

  return (
    <section>
      <SectionTitle>History</SectionTitle>
      {error ? (
        <EmptyState>Can&apos;t reach the indexer right now.</EmptyState>
      ) : !data?.length ? (
        <EmptyState>No duels yet.</EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {data.map((d) => (
            <HistoryRow key={d.id} duel={d} address={address} decimals={findToken(tokens, d.token)?.decimals} symbol={findToken(tokens, d.token)?.symbol} />
          ))}
        </Card>
      )}
    </section>
  );
}

function HistoryRow({ duel, address, decimals, symbol }: { duel: IndexerDuel; address: Address; decimals?: number; symbol?: string }) {
  const rival = sameAddress(duel.creator, address) ? duel.joiner : duel.creator;
  const outcome =
    duel.status === "Settled"
      ? sameAddress(duel.winner, address)
        ? { text: "Won", tone: "strong" as const }
        : { text: "Lost", tone: "red" as const }
      : { text: STATUS_LABEL[duel.status], tone: "neutral" as const };

  return (
    <Link href={`/duel/${duel.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-raised">
      <GameIcon game={duel.game} className="h-5 w-5 shrink-0 text-muted" />
      <span className="w-12 text-faint">#{duel.id}</span>
      <span className="min-w-0 flex-1 truncate text-muted">vs {rival ? shortAddress(rival) : "—"}</span>
      <span className="tabular font-semibold">
        {decimals !== undefined ? formatAmount(duel.amount, decimals) : "…"} {symbol}
      </span>
      <Badge tone={outcome.tone}>{outcome.text}</Badge>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Batas pribadi (docs/spec.md 5.2): disimpan di browser ini.
// ---------------------------------------------------------------------------

function PersonalLimits({ address }: { address: Address }) {
  const { tokens } = useArenaInfo();
  return (
    <section id="limits" data-testid="personal-limits">
      <SectionTitle>Personal limits</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="divide-y divide-line">
          <div className="p-4">
            <h3 className="font-bold">Daily stake limit</h3>
            <p className="mt-1 text-sm text-muted">
              Caps how much you can stake per token in any 24 hours. Lowering a limit applies now; raising or removing
              it takes effect after 24 hours.
            </p>
          </div>
          {tokens.map((t) => (
            <DailyLimitRow key={t.address} token={t} address={address} />
          ))}
        </Card>
        <TakeABreak />
      </div>
      <p className="mt-2 text-xs text-muted">Limits are saved in this browser only.</p>
    </section>
  );
}

function DailyLimitRow({ token, address }: { token: TokenInfo; address: Address }) {
  const limits = useLimits();
  const daily = useDailyAllowance(address, token.address, undefined);
  const pending = limits.pendingFor(token.address);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const fmt = (v: bigint) => `${formatAmount(v, token.decimals)} ${token.symbol}`;

  function save(amount: bigint | null) {
    try {
      limits.setLimit(token.address, amount);
      setText("");
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the limit.");
    }
  }

  const parsed = parseAmount(text, token.decimals);
  return (
    <div className="space-y-2 p-4" data-testid={`limit-${token.symbol}`}>
      <div className="tabular flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-bold">{token.symbol}</span>
        <span className="text-muted">
          {daily.limit === null ? (
            "No limit"
          ) : (
            <>
              Limit <b className="text-ink">{fmt(daily.limit)}</b> · used {fmt(daily.spent)} · left{" "}
              <b className="text-ink">{fmt(daily.remaining!)}</b>
            </>
          )}
        </span>
      </div>
      {pending && (
        <p className="text-xs text-muted">
          Change to {pending.amount === null ? "no limit" : fmt(pending.amount)} takes effect{" "}
          {new Date(pending.effectiveAt * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          inputMode="decimal"
          placeholder={`Limit in ${token.symbol}`}
          aria-label={`Daily limit in ${token.symbol}`}
          value={text}
          onChange={(e) => setText(e.target.value.replace(",", "."))}
          className="tabular h-9 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-sm"
        />
        <Button size="sm" variant="secondary" disabled={parsed === undefined || parsed === 0n} onClick={() => save(parsed!)}>
          Set limit
        </Button>
        {daily.limit !== null && (
          <Button size="sm" variant="ghost" onClick={() => save(null)}>
            Remove
          </Button>
        )}
      </div>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function TakeABreak() {
  const limits = useLimits();
  const [choice, setChoice] = useState<number>(BREAK_OPTIONS[0].seconds);
  const [confirming, setConfirming] = useState(false);
  const label = BREAK_OPTIONS.find((o) => o.seconds === choice)?.label;

  return (
    <Card className="p-4" >
      <h3 className="font-bold">Take a break</h3>
      <p className="mt-1 text-sm text-muted">
        Hides creating and joining duels in this browser for the period you choose. Revealing, refunds and claims keep
        working. A break can&apos;t be shortened once started.
      </p>
      {limits.onBreak ? (
        <div className="mt-4">
          <BreakNotice until={limits.breakUntil} />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Break length">
            {BREAK_OPTIONS.map((o) => (
              <button
                key={o.seconds}
                role="radio"
                aria-checked={choice === o.seconds}
                onClick={() => {
                  setChoice(o.seconds);
                  setConfirming(false);
                }}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
                  choice === o.seconds ? "border-red bg-red-deep text-ink" : "border-line text-muted hover:text-ink"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {confirming ? (
            <div className="space-y-2 rounded-lg border border-red/40 bg-red-deep p-3 text-sm">
              <p>You won&apos;t be able to create or join duels for {label}. This can&apos;t be undone.</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => limits.takeBreak(choice)}>
                  Start {label} break
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Not now
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
              Take a break
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

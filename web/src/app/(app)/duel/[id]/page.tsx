"use client";

import { duelArenaAbi } from "@rivl/contracts/abi";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAccount, useReadContract } from "wagmi";

import { CoinFlip, DiceDuel, SuitHands } from "@/components/arena";
import { Avatar } from "@/components/Avatar";
import { GameIcon } from "@/components/icons";
import { JoinDuelModal } from "@/components/JoinDuelModal";
import { Badge, BreakNotice, Button, Card, Row, SectionTitle, TxLink, TxNotice } from "@/components/ui";
import { findToken, useArenaInfo, useNow, type TokenInfo } from "@/hooks/useArena";
import { useLimits } from "@/hooks/useLimits";
import { useSuitSecrets } from "@/hooks/useSuitSecrets";
import { useTx } from "@/hooks/useTx";
import { appConfig, explorerAddress } from "@/lib/config";
import {
  GAMES,
  isZero,
  potBreakdown,
  sameAddress,
  SIDE_NAMES,
  STATUS_LABEL,
  STATUSES,
  type ChainDuel,
  type Game,
  type Status,
} from "@/lib/duel";
import { formatAmount, formatDuration, shortAddress } from "@/lib/format";
import { useIndexedDuel } from "@/lib/indexer";

export default function DuelPage() {
  const params = useParams<{ id: string }>();
  const id = /^\d+$/.test(params.id) ? BigInt(params.id) : undefined;
  const { arena } = appConfig();

  const { data, isLoading } = useReadContract({
    address: arena,
    abi: duelArenaAbi,
    functionName: "getDuel",
    args: id !== undefined ? [id] : undefined,
    query: { enabled: id !== undefined, refetchInterval: 1_500 },
  });
  const duel = data as ChainDuel | undefined;

  if (id === undefined || (!isLoading && (!duel || duel.status === 0))) {
    return (
      <div className="py-16 text-center">
        <h1 className="font-display text-2xl font-black">Duel not found</h1>
        <Link href="/" className="mt-4 inline-block text-blue hover:underline">
          Back to the lobby
        </Link>
      </div>
    );
  }
  if (!duel) return <p className="py-16 text-center text-muted">Loading duel…</p>;
  return <DuelView id={id} duel={duel} />;
}

function DuelView({ id, duel }: { id: bigint; duel: ChainDuel }) {
  const { address } = useAccount();
  const { tokens } = useArenaInfo();
  const { data: indexed } = useIndexedDuel(id);
  const now = useNow();

  const game = GAMES[duel.game] as Game;
  const status = STATUSES[duel.status] as Status;
  const token = findToken(tokens, duel.token);
  const isCreator = sameAddress(address, duel.creator);
  const isJoiner = sameAddress(address, duel.joiner);
  const { fee, payout } = potBreakdown(duel.amount, duel.feeBpsAtCreate);
  const fmt = (v: bigint) => (token ? `${formatAmount(v, token.decimals)} ${token.symbol}` : "…");

  const finished = status === "Settled" || status === "Draw";
  const winnerSide =
    status === "Settled" ? (sameAddress(duel.winner, duel.creator) ? "creator" : "joiner") : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 animate-rise">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-red/30 bg-red-deep text-red-bright">
          <GameIcon game={game} className="h-6 w-6" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-black sm:text-3xl">
            {game === "Dice" ? "Dice Duel" : game} <span className="text-faint">#{id.toString()}</span>
          </h1>
          <span data-testid="duel-status" data-status={status} className="mt-1 inline-flex">
            <Badge tone={status === "Settled" ? "strong" : status === "Open" ? "blue" : "neutral"}>
              <span
                aria-hidden
                className={`mr-1.5 h-1.5 w-1.5 rounded-full ${finished ? "bg-ink" : status === "Open" ? "bg-blue" : "bg-red"}`}
              />
              {STATUS_LABEL[status]}
            </Badge>
          </span>
        </div>
        <div className="ml-auto text-right">
          <div className="eyebrow text-[10px] text-faint">Stake each</div>
          <div className="tabular font-display text-2xl font-black sm:text-3xl">{fmt(duel.amount)}</div>
        </div>
      </div>

      <div className="stage edge-gradient overflow-hidden rounded-3xl border border-line animate-rise [animation-delay:80ms]">
        <div className="grid grid-cols-2">
          <Corner
            side="creator"
            label="Red corner"
            who={duel.creator}
            you={isCreator}
            choice={choiceLabel(game, duel, "creator")}
            outcome={winnerSide === undefined ? undefined : winnerSide === "creator" ? "win" : "lose"}
          />
          <Corner
            side="joiner"
            label="Blue corner"
            who={isZero(duel.joiner) ? undefined : duel.joiner}
            you={isJoiner}
            choice={choiceLabel(game, duel, "joiner")}
            outcome={winnerSide === undefined ? undefined : winnerSide === "joiner" ? "win" : "lose"}
          />
        </div>
        <div className="relative px-4 py-12 sm:py-14">
          <ArenaAnimation game={game} status={status} duel={duel} />
        </div>
        <ResultBanner status={status} duel={duel} address={address} payout={fmt(payout)} />
      </div>

      <Actions id={id} duel={duel} status={status} game={game} token={token} now={now} isCreator={isCreator} isJoiner={isJoiner} />

      <Card className="p-4">
        <SectionTitle>Details</SectionTitle>
        <dl className="tabular space-y-1.5 text-sm">
          <Row label="Stake per player" value={fmt(duel.amount)} />
          <Row label={`Fee (${duel.feeBpsAtCreate / 100}% of pot, locked at creation)`} value={fmt(fee)} />
          <Row label="Winner receives" value={fmt(payout)} />
          {game !== "Suit" && duel.requestId > 0n && <Row label="Randomness request" value={`#${duel.requestId}`} />}
          {game !== "Suit" && (status === "Settled" || status === "Draw") && (
            <Row label="Random word" value={<span className="break-all font-mono text-xs">{duel.randomWord.toString()}</span>} />
          )}
          {game === "Suit" && <Row label="Commit" value={<span className="break-all font-mono text-xs">{duel.commit}</span>} />}
        </dl>
        {(status === "Settled" || status === "Draw") && (
          <Link href={`/fair?id=${id}`} className="mt-4 inline-block text-sm font-semibold text-blue hover:underline">
            Verify this result →
          </Link>
        )}
        {indexed && (
          <>
            <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-[0.16em] text-muted">Transactions</h3>
            <ul className="space-y-1 text-sm">
              <TxItem label="Created" hash={indexed.createdTx} />
              {indexed.joinedTx && <TxItem label={game === "Suit" ? "Joined" : "Joined · randomness requested"} hash={indexed.joinedTx} />}
              {indexed.revealTx && <TxItem label="Revealed" hash={indexed.revealTx} />}
              {indexed.settledTx && <TxItem label={STATUS_LABEL[indexed.status]} hash={indexed.settledTx} />}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

function choiceLabel(game: Game, d: ChainDuel, side: "creator" | "joiner"): string | undefined {
  if (game === "Coinflip") return SIDE_NAMES[side === "creator" ? d.creatorChoice : 1 - d.creatorChoice];
  return undefined;
}

function Corner({
  side,
  label,
  who,
  you,
  choice,
  outcome,
}: {
  side: "creator" | "joiner";
  label: string;
  who?: string;
  you: boolean;
  choice?: string;
  outcome?: "win" | "lose";
}) {
  const red = side === "creator";
  const link = who ? explorerAddress(who) : undefined;
  return (
    <div
      className={`relative flex flex-col gap-3 p-4 transition-opacity duration-700 sm:flex-row sm:items-center sm:p-5 ${
        red ? "items-start" : "items-end text-right sm:flex-row-reverse"
      } ${outcome === "lose" ? "opacity-45" : ""}`}
    >
      <div aria-hidden className={`absolute inset-x-0 top-0 h-1 ${red ? "bg-red" : "bg-blue"}`} />
      <div className="relative">
        <Avatar
          address={who}
          corner={red ? "red" : "blue"}
          size={52}
          className={outcome === "win" ? (red ? "shadow-[0_0_40px_-4px_var(--color-red)]" : "shadow-[0_0_40px_-4px_var(--color-blue)]") : ""}
        />
      </div>
      <div className="min-w-0">
        <div className={`eyebrow whitespace-nowrap text-[10px] ${red ? "text-red" : "text-blue"}`}>{label}</div>
        <div className="mt-1 truncate font-mono text-sm text-ink">
          {who ? (
            link ? (
              <a href={link} target="_blank" rel="noreferrer" className="hover:underline">
                {shortAddress(who)}
              </a>
            ) : (
              shortAddress(who)
            )
          ) : (
            "Open seat"
          )}
          {you && <span className="ml-1.5 font-sans text-xs font-bold text-muted">(you)</span>}
        </div>
        <div className={`mt-1.5 flex flex-wrap items-center gap-1.5 ${red ? "" : "justify-end"}`}>
          {choice && (
            <span className="rounded-md bg-bg/60 px-1.5 py-0.5 text-[11px] font-semibold text-muted">{choice}</span>
          )}
          {outcome === "win" && (
            <span className={`rounded-md px-1.5 py-0.5 font-display-condensed text-[10px] font-black uppercase tracking-[0.14em] text-white ${red ? "bg-red" : "bg-blue"}`}>
              Winner
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ArenaAnimation({ game, status, duel }: { game: Game; status: Status; duel: ChainDuel }) {
  const finished = status === "Settled" || status === "Draw";
  if (game === "Coinflip") {
    const phase = status === "AwaitingRandomness" ? "waiting" : status === "Settled" ? "result" : "idle";
    return <CoinFlip phase={phase} result={phase === "result" ? duel.creatorResult : undefined} creatorSide={duel.creatorChoice} />;
  }
  if (game === "Dice") {
    const phase = status === "AwaitingRandomness" ? "waiting" : finished ? "result" : "idle";
    return (
      <DiceDuel
        phase={phase}
        creatorRoll={phase === "result" ? duel.creatorResult : undefined}
        joinerRoll={phase === "result" ? duel.joinerResult : undefined}
      />
    );
  }
  const phase = status === "AwaitingReveal" ? "waiting" : finished ? "result" : "idle";
  return (
    <SuitHands
      phase={phase}
      creatorMove={finished && duel.creatorChoice !== 0 ? duel.creatorChoice : undefined}
      joinerMove={isZero(duel.joiner) ? undefined : duel.joinerChoice}
    />
  );
}

function ResultBanner({ status, duel, address, payout }: { status: Status; duel: ChainDuel; address?: string; payout: string }) {
  let text: ReactNode = null;
  if (status === "Settled") {
    const won = sameAddress(address, duel.winner);
    const lost = !won && (sameAddress(address, duel.creator) || sameAddress(address, duel.joiner));
    const timeout = GAMES[duel.game] === "Suit" && duel.creatorChoice === 0;
    text = won ? (
      <>You won <b>{payout}</b></>
    ) : lost ? (
      <>You lost this one.</>
    ) : (
      <><b className="font-mono">{shortAddress(duel.winner)}</b> won {payout}</>
    );
    if (timeout) text = <>{text} <span className="text-muted">· creator didn&apos;t reveal in time</span></>;
  } else if (status === "Draw") text = <>Draw — both stakes returned, no fee.</>;
  else if (status === "Refunded") text = <>Randomness didn&apos;t arrive in time. Both stakes refunded, no fee.</>;
  else if (status === "Cancelled") text = <>Cancelled by the creator. Stake returned.</>;
  if (!text) return null;
  return (
    <div
      data-testid="duel-result"
      className="font-display-condensed border-t border-line/70 bg-bg/50 px-4 py-4 text-center text-lg font-bold animate-fade-in [&_b]:font-display [&_b]:font-black"
    >
      {text}
    </div>
  );
}

function Actions(props: {
  id: bigint;
  duel: ChainDuel;
  status: Status;
  game: Game;
  token?: TokenInfo;
  now?: number;
  isCreator: boolean;
  isJoiner: boolean;
}) {
  const { id, duel, status, game, token, now, isCreator, isJoiner } = props;
  const { address } = useAccount();
  const { arena } = appConfig();
  const secrets = useSuitSecrets();
  const limits = useLimits();
  const tx = useTx();
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: claimable } = useReadContract({
    address: arena,
    abi: duelArenaAbi,
    functionName: "claimable",
    args: address ? [address, duel.token] : undefined,
    query: { enabled: !!address, refetchInterval: 3_000 },
  });

  const deadline = Number(duel.deadline);
  const expiresAt = Number(duel.expiresAt);
  const left = (t: number) => (now === undefined ? undefined : t - now);
  const call = (label: string, functionName: string, args: readonly unknown[]) =>
    tx.send(label, { address: arena, abi: duelArenaAbi, functionName, args }).catch(() => {});

  const secret = game === "Suit" ? secrets.find(duel.commit) : undefined;
  const lines: ReactNode[] = [];
  const buttons: ReactNode[] = [];

  if (status === "Open") {
    const l = left(expiresAt);
    lines.push(l === undefined ? null : l > 0 ? <>Open for <b className="tabular">{formatDuration(l)}</b></> : <>Expired. {isCreator ? "Cancel to get your stake back." : "It can no longer be joined."}</>);
    if (isCreator) buttons.push(<Button key="cancel" variant="secondary" loading={tx.busy} onClick={() => call("Cancel duel", "cancel", [id])}>Cancel duel</Button>);
    else if (limits.onBreak) lines.push(<BreakNotice until={limits.breakUntil} />);
    else if (l === undefined || l > 0) buttons.push(<Button key="join" variant="blue" size="lg" onClick={() => setJoining(true)}>Join duel</Button>);
  }

  if (status === "AwaitingRandomness") {
    const l = left(deadline);
    if (l !== undefined && l < 0) {
      lines.push(<>Randomness is late. Anyone can refund both players (no fee).</>);
      buttons.push(<Button key="refund" variant="secondary" loading={tx.busy} onClick={() => call("Refund", "refundStuckRandomness", [id])}>Refund both players</Button>);
    } else {
      lines.push(<>Waiting for verifiable randomness. If it doesn&apos;t arrive, a refund opens in <b className="tabular">{l === undefined ? "…" : formatDuration(l)}</b>.</>);
    }
  }

  if (status === "AwaitingReveal") {
    const l = left(deadline);
    const closed = l !== undefined && l < 0;
    if (!closed) {
      lines.push(
        isCreator ? (
          <><b className="text-red">You need to reveal.</b> <span className="tabular">{l === undefined ? "…" : formatDuration(l)}</span> left — if you don&apos;t, your rival wins.</>
        ) : (
          <>Waiting for the creator to reveal. <span className="tabular">{l === undefined ? "…" : formatDuration(l)}</span> left, then the win can be claimed.</>
        ),
      );
      if (isCreator && secret) {
        buttons.push(
          <Button key="reveal" size="lg" loading={tx.busy} onClick={() => call("Reveal move", "revealSuit", [id, secret.move, secret.salt])}>
            Reveal my move
          </Button>,
        );
      } else if (isCreator) {
        lines.push(
          <span className="text-red">
            Your move for this duel isn&apos;t saved in this browser.{" "}
            <Link href="/me#backup" className="underline">Restore your backup</Link> to reveal.
          </span>,
        );
      }
    } else {
      lines.push(<>Reveal window closed. {isJoiner ? "Claim your win." : "Anyone can settle it — the rival wins."}</>);
      buttons.push(
        <Button key="timeout" variant={isJoiner ? "blue" : "secondary"} size="lg" loading={tx.busy} onClick={() => call("Claim timeout", "claimRevealTimeout", [id])}>
          {isJoiner ? "Claim timeout win" : "Settle (rival wins)"}
        </Button>,
      );
    }
  }

  // Tombol klaim hanya jika duel INI memberi dana ke pengguna (saldo claimable bisa berasal dari duel lain).
  const owedHere =
    (status === "Settled" && sameAddress(address, duel.winner)) ||
    ((status === "Draw" || status === "Refunded") && (isCreator || isJoiner)) ||
    (status === "Cancelled" && isCreator);
  const canClaim = owedHere && typeof claimable === "bigint" && claimable > 0n;
  if (canClaim && token) {
    buttons.push(
      <Button key="claim" size="lg" loading={tx.busy} onClick={() => call("Claim", "withdraw", [duel.token])}>
        Claim {formatAmount(claimable as bigint, token.decimals)} {token.symbol}
      </Button>,
    );
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard ditolak */
    }
  }

  return (
    <div className="space-y-3">
      {lines.filter(Boolean).map((l, i) => (
        <div key={i} className="text-sm text-ink/90">{l}</div>
      ))}
      <TxNotice state={tx.state} />
      <div className="flex flex-wrap items-center gap-2">
        {buttons}
        <Button variant="ghost" size="sm" onClick={copyLink} className="ml-auto">
          {copied ? "Link copied" : status === "Open" ? "Copy challenge link" : "Copy link"}
        </Button>
      </div>
      {joining && <JoinDuelModal id={id} open onClose={() => setJoining(false)} />}
    </div>
  );
}

function TxItem({ label, hash }: { label: string; hash: string }) {
  return (
    <li className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <TxLink hash={hash} />
    </li>
  );
}

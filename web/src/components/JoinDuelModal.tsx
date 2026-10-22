"use client";

import { duelArenaAbi } from "@rivl/contracts/abi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";

import { GameIcon, MoveIcon } from "./icons";
import { BreakNotice, Button, FieldError, Modal, Row, TxNotice } from "./ui";
import { findToken, useArenaInfo, useNow } from "@/hooks/useArena";
import { useDailyAllowance } from "@/hooks/useLimits";
import { useStake } from "@/hooks/useStake";
import { useTx } from "@/hooks/useTx";
import { appConfig } from "@/lib/config";
import { GAMES, potBreakdown, sameAddress, SIDE_NAMES, STATUSES, type ChainDuel } from "@/lib/duel";
import { formatAmount, shortAddress } from "@/lib/format";
import { MOVE_NAMES, MOVES, type Move } from "@/lib/suit";

export function JoinDuelModal({ id, open, onClose }: { id: bigint; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { arena } = appConfig();
  const { tokens, paused } = useArenaInfo();
  const now = useNow();
  const tx = useTx();
  const [move, setMove] = useState<Move | undefined>();

  const { data } = useReadContract({
    address: arena,
    abi: duelArenaAbi,
    functionName: "getDuel",
    args: [id],
    query: { enabled: open },
  });
  const duel = data as ChainDuel | undefined;

  useEffect(() => {
    if (!open) tx.reset();
  }, [open, tx.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const game = duel ? GAMES[duel.game] : undefined;
  const token = findToken(tokens, duel?.token);
  const stake = useStake(token, duel?.amount);
  const daily = useDailyAllowance(address, token?.address, duel?.amount);
  const breakdown = duel ? potBreakdown(duel.amount, duel.feeBpsAtCreate) : undefined;
  const own = sameAddress(duel?.creator, address);
  const expired = duel && now !== undefined && now > Number(duel.expiresAt);
  const notOpen = duel && STATUSES[duel.status] !== "Open";
  const blocker = !duel
    ? undefined
    : notOpen
      ? "This duel is no longer open."
      : expired
        ? "This duel has expired."
        : own
          ? "This is your duel. Share the link to find a rival."
          : paused
            ? "New duels are paused right now."
            : stake.insufficient
              ? `Not enough ${token?.symbol} in your wallet.`
              : daily.exceeds && token
                ? `This is over your daily limit. ${formatAmount(daily.remaining!, token.decimals)} ${token.symbol} left in the last 24 hours.`
                : undefined;
  const ready = !!duel && !blocker && (game !== "Suit" || move !== undefined);

  async function join() {
    if (!duel || !ready) return;
    try {
      await tx.send("Join duel", {
        address: arena,
        abi: duelArenaAbi,
        functionName: "join",
        args: [id, game === "Suit" ? move! : 0],
        value: token?.isEth ? duel.amount : undefined,
      });
      onClose();
      router.push(`/duel/${id}`);
    } catch {
      /* ditampilkan oleh TxNotice */
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Join duel #${id}`}>
      {!duel || !token || !game ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg border border-line bg-raised text-muted">
              <GameIcon game={game} className="h-6 w-6" />
            </span>
            <div>
              <div className="font-bold">{game === "Dice" ? "Dice Duel" : game}</div>
              <div className="text-sm text-muted">vs {shortAddress(duel.creator)}</div>
            </div>
          </div>

          {game === "Coinflip" && (
            <p className="rounded-lg border border-line bg-raised p-3 text-sm">
              Your rival called <b>{SIDE_NAMES[duel.creatorChoice]}</b>. You get{" "}
              <b className="text-blue">{SIDE_NAMES[1 - duel.creatorChoice]}</b>.
            </p>
          )}
          {game === "Dice" && <p className="text-sm text-muted">You both roll 1–100. Highest number wins; a tie refunds both.</p>}
          {game === "Suit" && (
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-muted">Your move</h3>
              <div className="grid grid-cols-3 gap-2">
                {MOVES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={move === m}
                    onClick={() => setMove(m)}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-3 font-bold ${
                      move === m ? "border-blue bg-blue-deep text-ink" : "border-line text-muted hover:border-line-strong"
                    }`}
                  >
                    <MoveIcon move={m} className="h-7 w-7" />
                    {MOVE_NAMES[m]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                Your move is public. Your rival committed theirs before you joined and can&apos;t change it.
              </p>
            </div>
          )}

          <dl className="tabular space-y-1.5 rounded-lg border border-line bg-raised p-3 text-sm">
            <Row label="Your stake" value={`${formatAmount(duel.amount, token.decimals)} ${token.symbol}`} />
            <Row
              label={`Fee (${duel.feeBpsAtCreate / 100}% of pot, locked)`}
              value={`${formatAmount(breakdown!.fee, token.decimals)} ${token.symbol}`}
            />
            <Row label="You win" strong value={`${formatAmount(breakdown!.payout, token.decimals)} ${token.symbol}`} />
          </dl>

          {blocker && <FieldError>{blocker}</FieldError>}
          <TxNotice state={tx.state} />

          {daily.onBreak ? (
            <BreakNotice until={daily.breakUntil} />
          ) : !isConnected ? (
            <Button variant="blue" size="lg" className="w-full" onClick={openConnectModal}>
              Connect wallet
            </Button>
          ) : stake.needsApproval ? (
            <Button
              variant="blue"
              size="lg"
              className="w-full"
              disabled={!!blocker}
              loading={tx.busy}
              onClick={() => tx.send(`Approve ${token.symbol}`, stake.approveCall()).catch(() => {})}
            >
              Approve {token.symbol}
            </Button>
          ) : (
            <Button variant="blue" size="lg" className="w-full" disabled={!ready} loading={tx.busy} onClick={join}>
              Join for {formatAmount(duel.amount, token.decimals)} {token.symbol}
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}

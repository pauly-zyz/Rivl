"use client";

import { duelArenaAbi } from "@rivl/contracts/abi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { parseEventLogs, zeroAddress, type Hex } from "viem";
import { useAccount, useReadContracts } from "wagmi";

import { GameIcon, MoveIcon } from "./icons";
import { Button, FieldError, Modal, Row, TxNotice } from "./ui";
import { useArenaInfo, type TokenInfo } from "@/hooks/useArena";
import { useStake } from "@/hooks/useStake";
import { useSuitSecrets } from "@/hooks/useSuitSecrets";
import { useTx } from "@/hooks/useTx";
import { appConfig } from "@/lib/config";
import { GAMES, GAME_TAGLINE, potBreakdown, SIDE_NAMES, type Game } from "@/lib/duel";
import { isUserRejection } from "@/lib/errors";
import { formatAmount, formatDuration, parseAmount } from "@/lib/format";
import { computeCommit, MOVE_NAMES, MOVES, randomSalt, type Move } from "@/lib/suit";

export function CreateDuelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { tokens, feeBps, paused } = useArenaInfo();
  const { arena, chain } = appConfig();
  const secrets = useSuitSecrets();
  const tx = useTx();

  const [game, setGame] = useState<Game>("Coinflip");
  const [tokenAddr, setTokenAddr] = useState<string>(zeroAddress);
  const [amountText, setAmountText] = useState("");
  const [side, setSide] = useState<0 | 1>(0);
  const [move, setMove] = useState<Move | undefined>();
  const [saveError, setSaveError] = useState<string>();

  const { data: timings } = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: arena, abi: duelArenaAbi, functionName: "openDuration" },
      { address: arena, abi: duelArenaAbi, functionName: "revealWindow" },
    ],
  });

  useEffect(() => {
    if (!open) tx.reset();
  }, [open, tx.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const token: TokenInfo | undefined = tokens.find((t) => t.address === tokenAddr) ?? tokens[0];
  const amount = token ? parseAmount(amountText, token.decimals) : undefined;
  const stake = useStake(token, amount);

  const rangeError =
    token && amount !== undefined && (amount < token.minStake || amount > token.maxStake)
      ? `Stake must be between ${formatAmount(token.minStake, token.decimals)} and ${formatAmount(token.maxStake, token.decimals)} ${token.symbol}.`
      : undefined;
  const choiceMissing = game === "Suit" && move === undefined;
  const ready = !!token && amount !== undefined && amount > 0n && !rangeError && !stake.insufficient && !choiceMissing && !paused;
  const breakdown = amount !== undefined && feeBps !== undefined ? potBreakdown(amount, feeBps) : undefined;

  async function approve() {
    await tx.send(`Approve ${token!.symbol}`, stake.approveCall()).catch(() => {});
  }

  async function create() {
    if (!ready || !address || !token || amount === undefined) return;
    const value = token.isEth ? amount : undefined;
    let commit: Hex | undefined;

    try {
      let receipt;
      if (game === "Suit") {
        // docs/spec.md 5.3: salt acak → commit di browser → simpan SEBELUM mengirim transaksi.
        const salt = randomSalt();
        commit = computeCommit({ chainId: chain.id, arena, creator: address, move: move!, salt });
        try {
          secrets.save({ chainId: chain.id, arena, creator: address, move: move!, salt, commit, createdAt: Date.now() });
          setSaveError(undefined);
        } catch (err) {
          // Tanpa salt tersimpan, pemain tidak bisa reveal. Jangan kirim transaksi.
          setSaveError(err instanceof Error ? err.message : "Could not save your move in this browser.");
          return;
        }
        receipt = await tx.send("Create duel", {
          address: arena,
          abi: duelArenaAbi,
          functionName: "createSuit",
          args: [token.address, amount, commit],
          value,
        });
      } else if (game === "Coinflip") {
        receipt = await tx.send("Create duel", {
          address: arena,
          abi: duelArenaAbi,
          functionName: "createCoinflip",
          args: [token.address, amount, side],
          value,
        });
      } else {
        receipt = await tx.send("Create duel", {
          address: arena,
          abi: duelArenaAbi,
          functionName: "createDice",
          args: [token.address, amount],
          value,
        });
      }

      const [created] = parseEventLogs({ abi: duelArenaAbi, logs: receipt.logs, eventName: "DuelCreated" });
      if (!created) return;
      if (commit) secrets.attach(commit, created.args.id);
      onClose();
      router.push(`/duel/${created.args.id}`);
    } catch (err) {
      // Transaksi tidak pernah terkirim → rahasia tidak terpakai.
      if (commit && isUserRejection(err)) secrets.remove(commit);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create duel">
      <div className="space-y-6">
        <Step n={1} title="Game">
          <div className="grid grid-cols-3 gap-2">
            {GAMES.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGame(g)}
                aria-pressed={game === g}
                className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-sm font-bold ${
                  game === g ? "border-red bg-red-deep text-ink" : "border-line text-muted hover:border-line-strong"
                }`}
              >
                <GameIcon game={g} className="h-6 w-6" />
                {g === "Dice" ? "Dice Duel" : g}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">{GAME_TAGLINE[game]}</p>
        </Step>

        <Step n={2} title="Token">
          <div className="grid grid-cols-2 gap-2">
            {tokens.map((t) => (
              <button
                key={t.address}
                type="button"
                disabled={!t.allowed}
                onClick={() => setTokenAddr(t.address)}
                aria-pressed={token?.address === t.address}
                className={`rounded-lg border px-3 py-2 text-left disabled:opacity-40 ${
                  token?.address === t.address ? "border-red bg-red-deep" : "border-line hover:border-line-strong"
                }`}
              >
                <div className="font-bold">{t.symbol}</div>
                <div className="tabular text-xs text-muted">
                  {formatAmount(t.minStake, t.decimals)}–{formatAmount(t.maxStake, t.decimals)} per player
                </div>
              </button>
            ))}
          </div>
          {token && isConnected && (
            <p className="tabular mt-2 text-xs text-muted">
              Balance: {stake.balance === undefined ? "…" : `${formatAmount(stake.balance, token.decimals)} ${token.symbol}`}
            </p>
          )}
        </Step>

        <Step n={3} title="Stake">
          <div className="flex items-center rounded-lg border border-line bg-raised focus-within:border-muted">
            <input
              inputMode="decimal"
              placeholder="0.0"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value.replace(",", "."))}
              className="tabular w-full bg-transparent px-3 py-3 text-lg font-bold outline-none"
              aria-label="Stake amount"
            />
            <span className="px-3 font-semibold text-muted">{token?.symbol}</span>
          </div>
          {token && (
            <div className="mt-2 flex gap-2">
              <QuickAmount label="Min" onClick={() => setAmountText(formatPlain(token.minStake, token.decimals))} />
              <QuickAmount label="Max" onClick={() => setAmountText(formatPlain(token.maxStake, token.decimals))} />
            </div>
          )}
          {amountText && amount === undefined && <FieldError>Enter a valid amount.</FieldError>}
          {rangeError && <FieldError>{rangeError}</FieldError>}
          {stake.insufficient && <FieldError>Not enough {token?.symbol} in your wallet.</FieldError>}
        </Step>

        <Step n={4} title={game === "Coinflip" ? "Your side" : game === "Suit" ? "Your move" : "Your pick"}>
          {game === "Coinflip" && (
            <div className="grid grid-cols-2 gap-2">
              {([0, 1] as const).map((s) => (
                <Choice key={s} selected={side === s} onClick={() => setSide(s)}>
                  {SIDE_NAMES[s]}
                </Choice>
              ))}
            </div>
          )}
          {game === "Dice" && <p className="text-sm text-muted">Nothing to pick. You and your rival each roll 1–100.</p>}
          {game === "Suit" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {MOVES.map((m) => (
                  <Choice key={m} selected={move === m} onClick={() => setMove(m)}>
                    <MoveIcon move={m} className="h-7 w-7" />
                    {MOVE_NAMES[m]}
                  </Choice>
                ))}
              </div>
              <p className="mt-2 text-sm text-muted">
                Your move stays hidden until you reveal it. When someone joins, you have{" "}
                {timings ? formatDuration(Number(timings[1])) : "…"} to come back and reveal — or your rival wins. It is
                saved in this browser; back it up from <span className="text-ink">My duels</span>.
              </p>
            </>
          )}
        </Step>

        <Step n={5} title="Summary">
          <dl className="tabular space-y-1.5 rounded-lg border border-line bg-raised p-3 text-sm">
            <Row label="Your stake" value={amount !== undefined && token ? `${formatAmount(amount, token.decimals)} ${token.symbol}` : "—"} />
            <Row
              label={`Fee (${feeBps !== undefined ? feeBps / 100 : "…"}% of pot)`}
              value={breakdown && token ? `${formatAmount(breakdown.fee, token.decimals)} ${token.symbol}` : "—"}
            />
            <Row
              label="You win"
              strong
              value={breakdown && token ? `${formatAmount(breakdown.payout, token.decimals)} ${token.symbol}` : "—"}
            />
            <p className="pt-1 text-xs text-muted">
              Draws and refunds return your stake with no fee. Open for {timings ? formatDuration(Number(timings[0])) : "…"};
              cancel any time before someone joins.
            </p>
          </dl>
        </Step>

        {paused && <FieldError>New duels are paused right now.</FieldError>}
        {saveError && <FieldError>{saveError}</FieldError>}
        <TxNotice state={tx.state} />

        {!isConnected ? (
          <Button size="lg" className="w-full" onClick={openConnectModal}>
            Connect wallet
          </Button>
        ) : stake.needsApproval ? (
          <Button size="lg" className="w-full" onClick={approve} disabled={!ready} loading={tx.busy}>
            Approve {token?.symbol}
          </Button>
        ) : (
          <Button size="lg" className="w-full" onClick={create} disabled={!ready} loading={tx.busy}>
            Create duel
          </Button>
        )}
      </div>
    </Modal>
  );
}

function formatPlain(amount: bigint, decimals: number) {
  return formatAmount(amount, decimals, decimals).replace(/,/g, "");
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-muted">
        <span className="tabular text-red">{n}</span> {title}
      </h3>
      {children}
    </section>
  );
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-3 font-bold ${
        selected ? "border-red bg-red-deep text-ink" : "border-line text-muted hover:border-line-strong"
      }`}
    >
      {children}
    </button>
  );
}

function QuickAmount({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-muted hover:text-ink">
      {label}
    </button>
  );
}

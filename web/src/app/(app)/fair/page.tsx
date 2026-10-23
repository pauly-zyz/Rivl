"use client";

import { duelArenaAbi } from "@rivl/contracts/abi";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent, type ReactNode } from "react";
import { toHex } from "viem";
import { useReadContract } from "wagmi";

import { Button, Card, SectionTitle, TxLink } from "@/components/ui";
import { findToken, useArenaInfo } from "@/hooks/useArena";
import { appConfig } from "@/lib/config";
import { diceRolls, GAMES, isZero, potBreakdown, sameAddress, SIDE_NAMES, STATUS_LABEL, STATUSES, type ChainDuel } from "@/lib/duel";
import { formatAmount, shortAddress } from "@/lib/format";
import { useIndexedDuel, type IndexerDuel } from "@/lib/indexer";
import { computeCommit, MOVE_NAMES, randomWordOf, suitWinner } from "@/lib/suit";

export default function FairPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header>
        <h1 className="font-display text-3xl font-black sm:text-5xl">Provably fair</h1>
        <p className="mt-3 text-muted">
          Nobody — not your rival, not Rivl — can choose or see a result in advance. There is no oracle and no operator:
          every result comes from the two players alone. You don&apos;t have to trust us: every number below comes from
          the chain, and this page recomputes each result in your browser.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4 text-sm">
          <h2 className="font-bold">Coinflip & Dice: two secrets, one result</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
            <li>
              The creator&apos;s browser picks a random 32-byte salt and posts only its hash:{" "}
              <code className="break-all">keccak256(abi.encode(chainId, arena, creator, 0, salt))</code>.
            </li>
            <li>The rival joins with a fresh random 32-byte seed of their own, in the open.</li>
            <li>
              The creator reveals the salt. The contract checks it against the hash, then computes{" "}
              <code className="break-all">randomWord = keccak256(abi.encode(salt, seed))</code>.
            </li>
            <li>
              The creator locked the salt before seeing the seed; the rival chose the seed without knowing the salt. If the
              creator doesn&apos;t reveal in time, the rival wins — so hiding a losing result doesn&apos;t help.
            </li>
          </ol>
        </Card>
        <Card className="p-4 text-sm">
          <h2 className="font-bold">Suit: commit–reveal</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
            <li>
              The creator posts <code className="break-all">keccak256(abi.encode(chainId, arena, creator, move, salt))</code>{" "}
              — a hash that hides the move.
            </li>
            <li>The rival picks a move in the open.</li>
            <li>The creator reveals move and salt; the contract rehashes them and rejects anything that doesn&apos;t match.</li>
            <li>If the creator doesn&apos;t reveal in time, the rival wins.</li>
          </ol>
        </Card>
      </section>

      <Suspense fallback={null}>
        <Verifier />
      </Suspense>
    </article>
  );
}

function Verifier() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("id") ?? "";
  const [text, setText] = useState(initial);
  const id = /^\d+$/.test(initial) && initial !== "0" ? BigInt(initial) : undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    const v = text.trim().replace(/^#/, "");
    router.replace(/^\d+$/.test(v) ? `/fair?id=${v}` : "/fair", { scroll: false });
  }

  return (
    <section>
      <SectionTitle>Verify a duel</SectionTitle>
      <form onSubmit={submit} className="flex gap-2">
        <input
          inputMode="numeric"
          placeholder="Duel ID, e.g. 42"
          aria-label="Duel ID"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="tabular h-11 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 font-bold outline-none focus:border-muted"
        />
        <Button type="submit">Verify</Button>
      </form>
      {id !== undefined && <Verification key={id.toString()} id={id} />}
    </section>
  );
}

type Check = { label: ReactNode; value?: ReactNode; ok?: boolean; tx?: string | null };

function Verification({ id }: { id: bigint }) {
  const { arena, chain } = appConfig();
  const { tokens } = useArenaInfo();
  const { data, isLoading } = useReadContract({ address: arena, abi: duelArenaAbi, functionName: "getDuel", args: [id] });
  const { data: indexed } = useIndexedDuel(id);
  const duel = data as ChainDuel | undefined;

  if (isLoading) return <p className="mt-4 text-muted">Loading duel #{id.toString()}…</p>;
  if (!duel || duel.status === 0) return <p className="mt-4 text-muted" data-testid="verify-not-found">Duel #{id.toString()} doesn&apos;t exist.</p>;

  const game = GAMES[duel.game]!;
  const status = STATUSES[duel.status]!;
  const token = findToken(tokens, duel.token);
  const fmt = (v: bigint) => (token ? `${formatAmount(v, token.decimals)} ${token.symbol}` : v.toString());
  const finished = status === "Settled" || status === "Draw";

  const ctx = { chainId: chain.id, arena };
  const checks: Check[] = game === "Suit" ? suitChecks(duel, indexed, ctx) : randomChecks(duel, indexed, game, ctx);

  if (status === "Settled") {
    const { fee, payout } = potBreakdown(duel.amount, duel.feeBpsAtCreate);
    const paid = indexed?.payout ? BigInt(indexed.payout) : undefined;
    checks.push({
      label: <>Payout = 2 × {fmt(duel.amount)} − {duel.feeBpsAtCreate / 100}% fee ({fmt(fee)})</>,
      value: fmt(payout),
      ok: paid === undefined ? undefined : paid === payout && BigInt(indexed!.fee ?? -1) === fee,
      tx: indexed?.settledTx,
    });
  }

  const decided = checks.filter((c) => c.ok !== undefined);
  const verified = finished && decided.length > 0 && decided.every((c) => c.ok);

  return (
    <Card className="mt-4 overflow-hidden" >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="font-black">
          {game === "Dice" ? "Dice Duel" : game} #{id.toString()}
        </h3>
        <span className="text-sm text-muted">· {STATUS_LABEL[status]}</span>
        <span className="tabular ml-auto text-sm font-bold">{fmt(duel.amount)} each</span>
      </div>
      <ol className="divide-y divide-line" data-testid="verify-steps">
        {checks.map((c, i) => (
          <li key={i} className="flex gap-3 px-4 py-3 text-sm">
            <span className="tabular w-5 shrink-0 font-bold text-faint">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div>{c.label}</div>
              {c.value !== undefined && <div className="mt-1 break-all font-mono text-xs text-ink">{c.value}</div>}
              {c.tx && (
                <div className="mt-1 text-xs">
                  <TxLink hash={c.tx} label={`tx ${shortAddress(c.tx)}`} />
                </div>
              )}
            </div>
            {c.ok !== undefined && (
              <span className={`shrink-0 text-xs font-bold ${c.ok ? "text-ink" : "text-red"}`}>{c.ok ? "✓ matches" : "✗ mismatch"}</span>
            )}
          </li>
        ))}
      </ol>
      <div
        data-testid="verify-verdict"
        data-verified={verified ? "true" : finished ? "false" : "pending"}
        className={`border-t px-4 py-3 text-sm font-semibold ${verified ? "border-line bg-raised" : finished ? "border-red/40 bg-red-deep" : "border-line text-muted"}`}
      >
        {verified
          ? "Verified: recomputing from on-chain data gives the same result the contract paid out."
          : finished
            ? "Could not verify every step. See the steps marked above."
            : `Not finished yet (${STATUS_LABEL[status]}). Come back once the result is on chain.`}
      </div>
    </Card>
  );
}

const ZERO_HASH = `0x${"0".repeat(64)}`;
const isZeroHash = (h: string) => h.toLowerCase() === ZERO_HASH;
type Ctx = { chainId: number; arena: `0x${string}` };

/** Commit pembuat + (setelah lawan join) tanda timeout atau langkah reveal yang sama untuk semua game. */
function commonChecks(d: ChainDuel, ix: IndexerDuel | null | undefined, joinedLabel: ReactNode): { checks: Check[]; done: boolean } {
  const status = STATUSES[d.status]!;
  const checks: Check[] = [{ label: "Creator's commit (hides the secret)", value: d.commit, tx: ix?.createdTx }];
  if (isZero(d.joiner)) return { checks: [...checks, { label: "Waiting for a rival." }], done: true };
  checks.push({ label: joinedLabel, tx: ix?.joinedTx });
  if (status === "AwaitingReveal") {
    return { checks: [...checks, { label: "Waiting for the creator to reveal. The salt stays secret until then." }], done: true };
  }
  // Selesai tanpa reveal (salt tidak pernah terisi) = claimRevealTimeout.
  if (status === "Settled" && isZeroHash(d.salt)) {
    checks.push({
      label: <>No reveal before the deadline → rival wins by timeout ({shortAddress(d.joiner)})</>,
      ok: sameAddress(d.winner, d.joiner),
      tx: ix?.settledTx,
    });
    return { checks, done: true };
  }
  return { checks, done: false };
}

function commitCheck(d: ChainDuel, move: number, ctx: Ctx): Check {
  const recomputed = computeCommit({ ...ctx, creator: d.creator, move, salt: d.salt });
  return {
    label: <>keccak256(abi.encode({ctx.chainId}, arena, creator, {move}, salt)) equals the commit</>,
    value: recomputed,
    ok: recomputed.toLowerCase() === d.commit.toLowerCase(),
  };
}

function randomChecks(d: ChainDuel, ix: IndexerDuel | null | undefined, game: "Coinflip" | "Dice", ctx: Ctx): Check[] {
  const status = STATUSES[d.status]!;
  const { checks, done } = commonChecks(d, ix, <>Rival joined with their random seed</>);
  if (!isZero(d.joiner) && !isZeroHash(d.joinerSeed)) checks[1] = { ...checks[1]!, value: d.joinerSeed };
  if (done) return checks;

  // Nilai move di reveal: 0 untuk Coinflip/Dice. Selain 0 = commit tidak valid → penerima menang.
  const move = ix?.revealedMove ?? 0;
  checks.push({ label: "Creator's revealed salt", value: d.salt, tx: ix?.revealTx });
  checks.push(commitCheck(d, move, ctx));
  if (move !== 0) {
    checks.push({
      label: <>Committed value {move} isn&apos;t valid for {game} → rival wins ({shortAddress(d.joiner)})</>,
      ok: status === "Settled" && sameAddress(d.winner, d.joiner),
      tx: ix?.settledTx,
    });
    return checks;
  }

  const w = randomWordOf(d.salt, d.joinerSeed);
  checks.push({
    label: "randomWord = keccak256(abi.encode(salt, seed))",
    value: <>{w.toString()}<br />{toHex(w, { size: 32 })}</>,
    ok: w === d.randomWord,
    tx: ix?.settledTx,
  });

  if (game === "Coinflip") {
    const r = Number(w % 2n);
    checks.push({ label: <>randomWord % 2 = {r} → <b>{SIDE_NAMES[r]}</b></>, ok: r === d.creatorResult });
    const creatorWins = r === d.creatorChoice;
    checks.push({
      label: <>Creator called {SIDE_NAMES[d.creatorChoice]} → {creatorWins ? "creator" : "rival"} wins ({shortAddress(creatorWins ? d.creator : d.joiner)})</>,
      ok: status === "Settled" && sameAddress(d.winner, creatorWins ? d.creator : d.joiner),
    });
    return checks;
  }

  const rolls = diceRolls(w);
  const mask = (1n << 128n) - 1n;
  checks.push({
    label: <>Creator: lower 128 bits % 100 + 1 = <b>{rolls.creator}</b></>,
    value: `${(w & mask).toString()} % 100 + 1 = ${rolls.creator}`,
    ok: rolls.creator === d.creatorResult,
  });
  checks.push({
    label: <>Rival: upper 128 bits % 100 + 1 = <b>{rolls.joiner}</b></>,
    value: `${(w >> 128n).toString()} % 100 + 1 = ${rolls.joiner}`,
    ok: rolls.joiner === d.joinerResult,
  });
  const outcome = rolls.creator === rolls.joiner ? "draw" : rolls.creator > rolls.joiner ? "creator" : "joiner";
  checks.push({
    label:
      outcome === "draw" ? <>Same number → draw, stakes returned with no fee</> : <>Highest roll wins → {outcome === "creator" ? "creator" : "rival"} ({shortAddress(outcome === "creator" ? d.creator : d.joiner)})</>,
    ok: outcome === "draw" ? status === "Draw" : status === "Settled" && sameAddress(d.winner, outcome === "creator" ? d.creator : d.joiner),
  });
  return checks;
}

function suitChecks(d: ChainDuel, ix: IndexerDuel | null | undefined, ctx: Ctx): Check[] {
  const status = STATUSES[d.status]!;
  const { checks, done } = commonChecks(d, ix, <>Rival&apos;s move (public): <b>{MOVE_NAMES[d.joinerChoice]}</b></>);
  if (done) return checks;

  const move = d.creatorChoice;
  checks.push({
    label: <>Revealed move <b>{MOVE_NAMES[move] ?? `invalid (${move})`}</b> and salt</>,
    value: d.salt,
    tx: ix?.revealTx,
  });
  checks.push(commitCheck(d, move, ctx));
  const outcome = suitWinner(move, d.joinerChoice);
  checks.push({
    label:
      outcome === "draw" ? (
        <>Same move → draw, stakes returned with no fee</>
      ) : (
        <>
          {MOVE_NAMES[move] ?? "Invalid move"} vs {MOVE_NAMES[d.joinerChoice]} → {outcome === "creator" ? "creator" : "rival"} wins (
          {shortAddress(outcome === "creator" ? d.creator : d.joiner)})
        </>
      ),
    ok: outcome === "draw" ? status === "Draw" : status === "Settled" && sameAddress(d.winner, outcome === "creator" ? d.creator : d.joiner),
    tx: ix?.settledTx,
  });
  return checks;
}

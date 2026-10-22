"use client";

import { duelArenaAbi } from "@rivl/contracts/abi";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent, type ReactNode } from "react";
import { decodeFunctionData, parseAbi, toHex, type Hex } from "viem";
import { usePublicClient, useReadContract } from "wagmi";

import { Button, Card, SectionTitle, TxLink } from "@/components/ui";
import { findToken, useArenaInfo } from "@/hooks/useArena";
import { appConfig } from "@/lib/config";
import { diceRolls, GAMES, isZero, potBreakdown, sameAddress, SIDE_NAMES, STATUS_LABEL, STATUSES, type ChainDuel } from "@/lib/duel";
import { formatAmount, shortAddress } from "@/lib/format";
import { useIndexedDuel, type IndexerDuel } from "@/lib/indexer";
import { computeCommit, MOVE_NAMES, suitWinner } from "@/lib/suit";

export default function FairPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header>
        <h1 className="font-display text-3xl font-black sm:text-5xl">Provably fair</h1>
        <p className="mt-3 text-muted">
          Nobody — not your rival, not Rivl — can choose or see a result in advance. You don&apos;t have to trust us:
          every number below comes from the chain, and this page recomputes each result in your browser.
        </p>
      </header>

      <RandomnessSource />

      <section className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4 text-sm">
          <h2 className="font-bold">Coinflip & Dice: verifiable randomness</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
            <li>When the rival joins, the contract requests a random number. Both stakes are already locked.</li>
            <li>The VRF service returns one random word with a cryptographic proof, checked on chain before delivery.</li>
            <li>The contract turns that word into the result with a fixed formula, shown step by step below.</li>
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
          </ol>
        </Card>
      </section>

      <Suspense fallback={null}>
        <Verifier />
      </Suspense>
    </article>
  );
}

/** Jenis sumber randomness yang dipasang di arena saat ini. */
function RandomnessSource() {
  const { arena } = appConfig();
  const client = usePublicClient();
  const { data: provider } = useReadContract({ address: arena, abi: duelArenaAbi, functionName: "randomnessProvider" });

  const { data: kind } = useQuery({
    queryKey: ["randomness-kind", provider],
    enabled: !!provider && !!client,
    queryFn: async () => {
      const tryRead = (signature: string, functionName: string) =>
        client!
          .readContract({ address: provider!, abi: parseAbi([signature]), functionName })
          .then(() => true)
          .catch(() => false);
      if (await tryRead("function coordinator() view returns (address)", "coordinator")) return "vrf" as const;
      if (await tryRead("function lastRequestId() view returns (uint256)", "lastRequestId")) return "dev" as const;
      return "other" as const;
    },
  });

  if (!provider || !kind) return null;
  return (
    <section data-testid="randomness-source" data-kind={kind}>
      {kind === "dev" ? (
        <div className="rounded-xl border-2 border-red bg-red-deep p-4 text-sm">
          <p className="font-bold">Development randomness</p>
          <p className="mt-1 text-ink/85">
            This deployment uses DevRandomnessProvider ({shortAddress(provider)}): the operator supplies the random
            numbers. Results here are <b>not</b> provably fair. This is only for local and test networks.
          </p>
        </div>
      ) : (
        <Card className="p-4 text-sm">
          <p className="font-bold">{kind === "vrf" ? "Chainlink VRF v2.5" : "Custom randomness provider"}</p>
          <p className="mt-1 text-muted">
            Randomness provider: <span className="font-mono">{provider}</span>
            {kind === "vrf" && ". The VRF coordinator verifies each proof on chain before the number reaches the duel."}
          </p>
        </Card>
      )}
    </section>
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
  const client = usePublicClient();
  const { tokens } = useArenaInfo();
  const { data, isLoading } = useReadContract({ address: arena, abi: duelArenaAbi, functionName: "getDuel", args: [id] });
  const { data: indexed } = useIndexedDuel(id);
  const duel = data as ChainDuel | undefined;

  // Suit: salt hanya ada di calldata transaksi reveal (tidak disimpan di storage contract).
  const { data: reveal } = useQuery({
    queryKey: ["reveal-calldata", indexed?.revealTx],
    enabled: !!indexed?.revealTx && !!client,
    staleTime: Infinity,
    queryFn: async () => {
      const tx = await client!.getTransaction({ hash: indexed!.revealTx! });
      const decoded = decodeFunctionData({ abi: duelArenaAbi, data: tx.input });
      if (decoded.functionName !== "revealSuit") throw new Error("Not a reveal transaction");
      const [, move, salt] = decoded.args as readonly [bigint, number, Hex];
      return { move, salt };
    },
  });

  if (isLoading) return <p className="mt-4 text-muted">Loading duel #{id.toString()}…</p>;
  if (!duel || duel.status === 0) return <p className="mt-4 text-muted" data-testid="verify-not-found">Duel #{id.toString()} doesn&apos;t exist.</p>;

  const game = GAMES[duel.game]!;
  const status = STATUSES[duel.status]!;
  const token = findToken(tokens, duel.token);
  const fmt = (v: bigint) => (token ? `${formatAmount(v, token.decimals)} ${token.symbol}` : v.toString());
  const finished = status === "Settled" || status === "Draw";

  const checks: Check[] =
    game === "Suit"
      ? suitChecks(duel, indexed, reveal, { chainId: chain.id, arena })
      : randomChecks(duel, indexed, game);

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

function randomChecks(d: ChainDuel, ix: IndexerDuel | null | undefined, game: "Coinflip" | "Dice"): Check[] {
  const status = STATUSES[d.status]!;
  const checks: Check[] = [];
  if (isZero(d.joiner)) return [{ label: "Waiting for a rival. Randomness is requested only when someone joins." }];

  checks.push({ label: <>Rival joined; randomness requested (request #{d.requestId.toString()})</>, tx: ix?.joinedTx });
  if (status !== "Settled" && status !== "Draw") {
    checks.push({ label: status === "Refunded" ? "Randomness didn't arrive in time — both stakes refunded." : "Waiting for the random word…" });
    return checks;
  }

  const w = d.randomWord;
  checks.push({ label: "Random word delivered on chain", value: <>{w.toString()}<br />{toHex(w, { size: 32 })}</>, tx: ix?.settledTx });

  if (game === "Coinflip") {
    const r = Number(w % 2n);
    checks.push({ label: <>randomWord % 2 = {r} → <b>{SIDE_NAMES[r]}</b></>, ok: r === d.creatorResult });
    const creatorWins = r === d.creatorChoice;
    checks.push({
      label: <>Creator called {SIDE_NAMES[d.creatorChoice]} → {creatorWins ? "creator" : "rival"} wins ({shortAddress(creatorWins ? d.creator : d.joiner)})</>,
      ok: sameAddress(d.winner, creatorWins ? d.creator : d.joiner),
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

function suitChecks(
  d: ChainDuel,
  ix: IndexerDuel | null | undefined,
  reveal: { move: number; salt: Hex } | undefined,
  ctx: { chainId: number; arena: `0x${string}` },
): Check[] {
  const status = STATUSES[d.status]!;
  const checks: Check[] = [{ label: "Creator's commit (hides the move)", value: d.commit, tx: ix?.createdTx }];
  if (isZero(d.joiner)) return [...checks, { label: "Waiting for a rival." }];

  checks.push({ label: <>Rival&apos;s move (public): <b>{MOVE_NAMES[d.joinerChoice]}</b></>, tx: ix?.joinedTx });

  if (status === "AwaitingReveal") return [...checks, { label: "Waiting for the creator to reveal. The salt stays secret until then." }];
  if (!ix) return [...checks, { label: "Loading transactions…" }];
  // Tanpa transaksi reveal, duel Suit hanya bisa selesai lewat claimRevealTimeout.
  if (status === "Settled" && !ix.revealTx) {
    return [
      ...checks,
      {
        label: <>No reveal before the deadline → rival wins by timeout ({shortAddress(d.joiner)})</>,
        ok: sameAddress(d.winner, d.joiner),
        tx: ix?.settledTx,
      },
    ];
  }
  if (!reveal) return [...checks, { label: "Loading the reveal transaction…" }];

  const recomputed = computeCommit({ ...ctx, creator: d.creator, move: reveal.move, salt: reveal.salt });
  checks.push({
    label: <>Revealed move <b>{MOVE_NAMES[reveal.move] ?? `invalid (${reveal.move})`}</b> and salt (from the reveal transaction)</>,
    value: reveal.salt,
    tx: ix?.revealTx,
  });
  checks.push({
    label: <>keccak256(abi.encode({ctx.chainId}, arena, creator, {reveal.move}, salt)) equals the commit</>,
    value: recomputed,
    ok: recomputed.toLowerCase() === d.commit.toLowerCase(),
  });
  const outcome = suitWinner(reveal.move, d.joinerChoice);
  checks.push({
    label:
      outcome === "draw" ? (
        <>Same move → draw, stakes returned with no fee</>
      ) : (
        <>
          {MOVE_NAMES[reveal.move] ?? "Invalid move"} vs {MOVE_NAMES[d.joinerChoice]} → {outcome === "creator" ? "creator" : "rival"} wins (
          {shortAddress(outcome === "creator" ? d.creator : d.joiner)})
        </>
      ),
    ok: outcome === "draw" ? status === "Draw" : status === "Settled" && sameAddress(d.winner, outcome === "creator" ? d.creator : d.joiner),
    tx: ix?.settledTx,
  });
  return checks;
}

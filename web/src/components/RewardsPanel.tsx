"use client";

import { rivlRewardsAbi } from "@rivl/contracts/abi";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { zeroAddress, type Address, type Hex } from "viem";
import { useReadContract, useReadContracts, useSignMessage } from "wagmi";

import { Avatar } from "./Avatar";
import { Badge, Button, Card, SectionTitle, TxNotice } from "./ui";
import { findToken, useArenaInfo } from "@/hooks/useArena";
import { useTx } from "@/hooks/useTx";
import { appConfig } from "@/lib/config";
import { RARITY_STYLE, titleStyle } from "@/lib/cosmetics";
import { sameAddress } from "@/lib/duel";
import { formatAmount } from "@/lib/format";
import {
  adminMessage,
  equipMessage,
  post,
  PRIZE_LABEL,
  PRIZE_ORDER,
  usePlayerRewards,
  useRewardsInfo,
  useRewardsProof,
  type CosmeticKind,
  type Equipped,
  type Prize,
  type RewardsInfo,
  type Settings,
} from "@/lib/rewards";

function useTokenFormat() {
  const { tokens } = useArenaInfo();
  const { data: info } = useRewardsInfo();
  return (token: string, amount: bigint) => {
    if (info?.token && sameAddress(token, info.token.address))
      return `${formatAmount(amount, info.token.decimals, 0)} ${info.token.symbol}`;
    if (token.toLowerCase() === zeroAddress)
      return `${formatAmount(amount, 18)} ETH`;
    const t = findToken(tokens, token);
    return t
      ? `${formatAmount(amount, t.decimals)} ${t.symbol}`
      : `${amount} units`;
  };
}

/** Bagian "Rewards" di /me: level, voucher, klaim mingguan, kosmetik. */
export function MyRewards({ address }: { address: Address }) {
  const { data: info } = useRewardsInfo();
  const { data: player } = usePlayerRewards(address);
  if (!info || !player) return null;
  const fresh =
    info.blocker === "token" &&
    player.history.length === 0 &&
    player.inventory.length === 0;
  if (fresh) return null;

  const into = player.xp % player.levelXp;
  return (
    <section id="rewards" className="scroll-mt-24" data-testid="my-rewards">
      <SectionTitle
        aside={
          <Link
            href="/spin"
            className="text-sm font-semibold text-blue-bright hover:underline"
          >
            Daily Spin →
          </Link>
        }
      >
        Rewards
      </SectionTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="eyebrow text-[10px] text-muted">Level</p>
          <p
            className="tabular font-display text-3xl font-black"
            data-testid="rewards-level"
          >
            {player.level}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full bg-blue"
              style={{ width: `${(into / player.levelXp) * 100}%` }}
            />
          </div>
          <p className="tabular mt-1 text-xs text-muted">
            {player.xp} XP · {player.levelXp - into} XP to level{" "}
            {player.level + 1}
          </p>
        </Card>
        <Card className="p-4">
          <p className="eyebrow text-[10px] text-muted">Fee-free wins left</p>
          <p
            className="tabular font-display text-3xl font-black"
            data-testid="rewards-vouchers"
          >
            {player.vouchers.remaining}
          </p>
          <p className="mt-1 text-xs text-muted">
            Used automatically on your next winning duels.{" "}
            {player.rebates.length > 0 &&
              `${player.rebates.length} refunded so far.`}
          </p>
        </Card>
        <WeeklyClaim address={address} info={info} earned={player.earned} />
      </div>
      <Inventory
        address={address}
        info={info}
        owned={player.inventory.map((i) => i.id)}
        equipped={player.equipped}
      />
    </section>
  );
}

function WeeklyClaim({
  address,
  info,
  earned,
}: {
  address: Address;
  info: RewardsInfo;
  earned: { token: Address; amount: string }[];
}) {
  const fmt = useTokenFormat();
  const tx = useTx();
  const { data: proof } = useRewardsProof(address);
  const rewards = proof?.rewards ?? info.rewards ?? undefined;
  const claims = proof?.claims ?? [];
  const { data: amounts } = useReadContracts({
    allowFailure: true,
    contracts: claims.map((c) => ({
      address: rewards!,
      abi: rivlRewardsAbi,
      functionName: "claimableAmount" as const,
      args: [address, c.token, BigInt(c.cumulativeAmount), c.proof] as const,
    })),
    query: { enabled: !!rewards && claims.length > 0, refetchInterval: 20_000 },
  });
  const ready = claims
    .map((c, i) => ({
      ...c,
      now: (amounts?.[i]?.result as bigint | undefined) ?? 0n,
    }))
    .filter((c) => c.now > 0n);
  const published = new Map(
    claims.map((c) => [c.token.toLowerCase(), BigInt(c.cumulativeAmount)]),
  );
  const waiting = earned
    .map((e) => ({
      token: e.token,
      amount: BigInt(e.amount) - (published.get(e.token.toLowerCase()) ?? 0n),
    }))
    .filter((e) => e.amount > 0n);

  return (
    <Card className="p-4">
      <div data-testid="weekly-claim">
        <p className="eyebrow text-[10px] text-muted">Weekly claim</p>
        {ready.length > 0 ? (
          <>
            <ul className="mt-1 space-y-0.5 text-sm font-bold">
              {ready.map((c) => (
                <li key={c.token} className="tabular">
                  {fmt(c.token, c.now)}
                </li>
              ))}
            </ul>
            <Button
              className="mt-3"
              size="sm"
              loading={tx.busy}
              data-testid="claim-rewards"
              onClick={() =>
                tx
                  .send("Claim rewards", {
                    address: rewards!,
                    abi: rivlRewardsAbi,
                    functionName: "claim",
                    args: [
                      address,
                      ready.map((c) => ({
                        token: c.token,
                        cumulativeAmount: BigInt(c.cumulativeAmount),
                        proof: c.proof,
                      })),
                    ],
                  })
                  .catch(() => {})
              }
            >
              Claim all
            </Button>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">Nothing to claim right now.</p>
        )}
        {waiting.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Next weekly drop:{" "}
            {waiting.map((w) => fmt(w.token, w.amount)).join(" + ")}
          </p>
        )}
        <TxNotice state={tx.state} />
      </div>
    </Card>
  );
}

const KINDS: { kind: CosmeticKind; label: string }[] = [
  { kind: "frame", label: "Frames" },
  { kind: "badge", label: "Badges" },
  { kind: "title", label: "Titles" },
];

function Inventory({
  address,
  info,
  owned,
  equipped,
}: {
  address: Address;
  info: RewardsInfo;
  owned: string[];
  equipped: Equipped;
}) {
  const queryClient = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const [draft, setDraft] = useState<Equipped>(equipped);
  const [status, setStatus] = useState<{
    busy?: boolean;
    error?: string;
    saved?: boolean;
  }>({});
  useEffect(
    () => setDraft(equipped),
    [equipped.frame, equipped.badge, equipped.title],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const items = info.cosmetics.filter((c) => owned.includes(c.id));
  const changed =
    draft.frame !== equipped.frame ||
    draft.badge !== equipped.badge ||
    draft.title !== equipped.title;
  const titleItem = info.cosmetics.find((c) => c.id === draft.title);

  const save = async () => {
    setStatus({ busy: true });
    try {
      const issuedAt = Math.floor(Date.now() / 1000);
      const signature = await signMessageAsync({
        message: equipMessage(address, draft, issuedAt),
      });
      await post("/equip", { address, ...draft, issuedAt, signature });
      await queryClient.invalidateQueries({ queryKey: ["rewards"] });
      setStatus({ saved: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({
        error: /reject|denied|cancel/i.test(msg)
          ? "Signature cancelled in your wallet."
          : msg,
      });
    }
  };

  return (
    <Card className="mt-4 p-4">
      <div data-testid="inventory">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar
            address={address}
            corner="red"
            size={64}
            className="rounded-2xl"
            plain
            frame={draft.frame}
            badge={draft.badge}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Your look</p>
            {titleItem ? (
              <p
                className={`eyebrow text-[11px] ${titleStyle(titleItem.rarity).className}`}
                style={titleStyle(titleItem.rarity).style}
              >
                {titleItem.name}
              </p>
            ) : (
              <p className="text-xs text-muted">
                Win cosmetics from the Daily Spin and show them in every duel.
              </p>
            )}
          </div>
          <Button
            size="sm"
            disabled={!changed}
            loading={status.busy}
            onClick={save}
            data-testid="equip-save"
          >
            Save look
          </Button>
        </div>
        {status.error && (
          <p className="mt-2 text-sm text-red">{status.error}</p>
        )}
        {status.saved && !changed && (
          <p className="mt-2 text-sm text-muted">
            Saved — everyone sees your new look in duels.
          </p>
        )}
        {items.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No cosmetics yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {KINDS.map(({ kind, label }) => {
              const list = items.filter((i) => i.kind === kind);
              if (list.length === 0) return null;
              return (
                <div key={kind}>
                  <p className="eyebrow mb-1.5 text-[10px] text-muted">
                    {label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {list.map((i) => {
                      const on = draft[kind] === i.id;
                      return (
                        <button
                          key={i.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              [kind]: on ? null : i.id,
                            }))
                          }
                          className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                            on
                              ? "border-blue bg-blue-deep text-ink"
                              : `${RARITY_STYLE[i.rarity].border} bg-raised/60 text-muted hover:text-ink`
                          }`}
                          data-testid={`equip-${i.id}`}
                        >
                          <span className={RARITY_STYLE[i.rarity].text}>●</span>{" "}
                          {i.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Owner: pengaturan Daily Spin + publikasi klaim mingguan
// ---------------------------------------------------------------------------

const ownerAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export function SpinOwnerPanel({ address }: { address: Address }) {
  const { data: info } = useRewardsInfo();
  const target = info?.rewards ?? appConfig().arena;
  const { data: owner } = useReadContract({
    address: target,
    abi: ownerAbi,
    functionName: "owner",
    query: { enabled: !!info },
  });
  if (!info || !sameAddress(owner as string | undefined, address)) return null;
  return <SpinOwnerForm address={address} info={info} />;
}

type Prepared = {
  epoch: number;
  root: Hex;
  accounts: number;
  owed: Record<string, string>;
  balances: Record<string, string>;
};

function SpinOwnerForm({
  address,
  info,
}: {
  address: Address;
  info: RewardsInfo;
}) {
  const queryClient = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const fmt = useTokenFormat();
  const tx = useTx();
  const s = info.settings;
  const [enabled, setEnabled] = useState(s.enabled);
  const [launch, setLaunch] = useState(
    s.launchAt ? toLocalInput(s.launchAt) : "",
  );
  const [holdTokens, setHoldTokens] = useState(s.minHoldTokens);
  const [holdHours, setHoldHours] = useState(String(s.minHoldHours));
  const [budget, setBudget] = useState(s.weeklyRivlBudget);
  const [jackpot, setJackpot] = useState(String(s.jackpotPpm / 10_000));
  const [jackpotMax, setJackpotMax] = useState(String(s.jackpotWeeklyMax));
  const [jackpotDelay, setJackpotDelay] = useState(String(s.jackpotDelayDays));
  const [pity, setPity] = useState(String(s.pityAfter));
  const [odds, setOdds] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(s.odds).map(([k, v]) => [k, String(v / 10_000)]),
    ),
  );
  const [msg, setMsg] = useState<{
    error?: string;
    ok?: string;
    busy?: boolean;
  }>({});
  const [prepared, setPrepared] = useState<Prepared>();

  const toPpm = (v: string) => Math.round(Number(v.replace(",", ".")) * 10_000);
  const sum = Object.values(odds).reduce((n, v) => n + toPpm(v), 0);

  const admin = async <T,>(action: string, data: unknown): Promise<T> => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await signMessageAsync({
      message: adminMessage(action, issuedAt, data),
    });
    return post<T>("/admin", { action, issuedAt, data, signature });
  };
  const run = async (fn: () => Promise<string>) => {
    setMsg({ busy: true });
    try {
      setMsg({ ok: await fn() });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setMsg({
        error: /reject|denied|cancel/i.test(m)
          ? "Signature cancelled in your wallet."
          : m,
      });
    }
  };

  const saveSettings = () =>
    run(async () => {
      const data: Settings = {
        enabled,
        launchAt: launch ? Math.floor(new Date(launch).getTime() / 1000) : null,
        jackpotDelayDays: Number(jackpotDelay),
        jackpotPpm: toPpm(jackpot),
        jackpotWeeklyMax: Number(jackpotMax),
        minHoldTokens: holdTokens.replace(/[^\d]/g, ""),
        minHoldHours: Number(holdHours),
        weeklyRivlBudget: budget.replace(/[^\d]/g, ""),
        pityAfter: Number(pity),
        odds: Object.fromEntries(
          Object.entries(odds).map(([k, v]) => [k, toPpm(v)]),
        ) as Settings["odds"],
      };
      await admin("settings", data);
      await queryClient.invalidateQueries({ queryKey: ["rewards"] });
      return "Daily Spin settings saved.";
    });

  const prepare = () =>
    run(async () => {
      const p = await admin<Prepared>("prepare", null);
      setPrepared(p);
      return `Week #${p.epoch} ready: ${p.accounts} wallet(s). Publish it on-chain to open claims.`;
    });

  const input =
    "tabular h-9 w-full rounded-lg border border-line bg-raised px-2.5 text-sm outline-none focus:border-muted";
  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    testid?: string,
    hint?: string,
  ) => (
    <label className="block text-xs text-muted">
      {label}
      <input
        className={`${input} mt-1 text-ink`}
        value={value}
        onChange={(e) => set(e.target.value)}
        data-testid={testid}
      />
      {hint && (
        <span className="mt-0.5 block text-[10px] text-faint">{hint}</span>
      )}
    </label>
  );

  return (
    <section
      className="rounded-2xl border border-line bg-surface/80 p-4 sm:p-5"
      data-testid="spin-owner-panel"
    >
      <h2 className="text-lg font-black">Daily Spin controls</h2>
      <p className="mt-1 text-sm text-muted">
        Only you see this. Settings are signed with your wallet (free). Status:{" "}
        <Badge tone={info.blocker ? "neutral" : "blue"}>
          {info.blocker ? `closed (${info.blocker})` : "open"}
        </Badge>
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-line bg-bg/50 p-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              data-testid="spin-enabled"
            />
            Spin enabled
          </label>
          <label className="block text-xs text-muted">
            Launch date (jackpot starts {jackpotDelay} days later)
            <input
              type="datetime-local"
              className={`${input} mt-1 text-ink`}
              value={launch}
              onChange={(e) => setLaunch(e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {field(
              "Min. hold (RIVL)",
              holdTokens,
              setHoldTokens,
              "spin-hold-tokens",
            )}
            {field(
              "Hold time (hours)",
              holdHours,
              setHoldHours,
              "spin-hold-hours",
            )}
            {field("Weekly RIVL budget", budget, setBudget)}
            {field("Pity after N misses", pity, setPity)}
            {field(
              "Jackpot %",
              jackpot,
              setJackpot,
              undefined,
              "taken from +150 XP (or the biggest slice)",
            )}
            {field("Jackpots per week", jackpotMax, setJackpotMax)}
            {field("Jackpot delay (days)", jackpotDelay, setJackpotDelay)}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg/50 p-3">
          <p className="text-sm font-semibold">Odds (%)</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {PRIZE_ORDER.filter(
              (p): p is Exclude<Prize, "jackpot"> => p !== "jackpot",
            ).map((p) => (
              <label key={p} className="block text-xs text-muted">
                {PRIZE_LABEL[p]}
                <input
                  className={`${input} mt-1 text-ink`}
                  value={odds[p] ?? "0"}
                  onChange={(e) =>
                    setOdds((o) => ({ ...o, [p]: e.target.value }))
                  }
                  data-testid={`spin-odds-${p}`}
                />
              </label>
            ))}
          </div>
          <p
            className={`tabular mt-2 text-xs ${sum === 1_000_000 ? "text-muted" : "text-red"}`}
          >
            Total: {(sum / 10_000).toFixed(3)}% (must be 100%)
          </p>
        </div>
      </div>
      <Button
        className="mt-3"
        size="sm"
        onClick={saveSettings}
        loading={msg.busy}
        disabled={sum !== 1_000_000}
        data-testid="spin-save"
      >
        Save spin settings
      </Button>

      <div className="mt-5 rounded-xl border border-line bg-bg/50 p-3">
        <p className="text-sm font-semibold">Weekly claim</p>
        <p className="text-xs text-muted">
          Once a week: prepare the totals (RIVL prizes + fee refunds), then
          publish the root on-chain. Make sure the rewards contract{" "}
          {info.rewards ? (
            <span className="font-mono">{info.rewards}</span>
          ) : (
            "(not deployed yet)"
          )}{" "}
          holds enough tokens.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={prepare}
            loading={msg.busy}
            disabled={!info.rewards}
            data-testid="spin-prepare"
          >
            Prepare this week
          </Button>
          {prepared && (
            <Button
              size="sm"
              loading={tx.busy}
              data-testid="spin-publish"
              onClick={() =>
                tx
                  .send(`Publish week #${prepared.epoch}`, {
                    address: info.rewards!,
                    abi: rivlRewardsAbi,
                    functionName: "setRoot",
                    args: [prepared.root, BigInt(prepared.epoch)],
                  })
                  .then(() =>
                    queryClient.invalidateQueries({ queryKey: ["rewards"] }),
                  )
                  .catch(() => {})
              }
            >
              Publish week #{prepared.epoch}
            </Button>
          )}
        </div>
        {prepared && (
          <ul className="mt-2 space-y-0.5 text-xs">
            {Object.entries(prepared.owed).map(([token, owed]) => {
              const bal = BigInt(prepared.balances[token] ?? "0");
              const short = bal < BigInt(owed);
              return (
                <li key={token} className={short ? "text-red" : "text-muted"}>
                  Still owed {fmt(token, BigInt(owed))} · contract holds{" "}
                  {fmt(token, bal)} {short && "— top up before players claim"}
                </li>
              );
            })}
          </ul>
        )}
        <TxNotice state={tx.state} />
      </div>
      {msg.error && (
        <p className="mt-2 text-sm text-red" role="alert">
          {msg.error}
        </p>
      )}
      {msg.ok && (
        <p className="mt-2 text-sm text-muted" data-testid="spin-owner-ok">
          {msg.ok}
        </p>
      )}
      <p className="sr-only">{address}</p>
    </section>
  );
}

function toLocalInput(unix: number) {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

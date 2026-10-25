"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { useAccount, useSignMessage } from "wagmi";

import { Avatar } from "@/components/Avatar";
import { SpinWheel, targetRotation } from "@/components/SpinWheel";
import { Badge, Button, Card, SectionTitle } from "@/components/ui";
import { BADGES, FRAMES, RARITY_STYLE, titleStyle } from "@/lib/cosmetics";
import { formatAmount, formatDuration } from "@/lib/format";
import {
  fairnessOf,
  post,
  PRIZE_LABEL,
  PRIZE_ORDER,
  spinMessage,
  usePlayerRewards,
  useRewardsInfo,
  type CosmeticInfo,
  type PlayerRewards,
  type Prize,
  type RewardsInfo,
  type SpinResult,
} from "@/lib/rewards";
import { sfx } from "@/lib/sfx";

const BLOCKER_TEXT: Record<string, string> = {
  token: "Daily Spin opens when $RIVL launches. Get ready — hold RIVL to unlock a free spin every day.",
  secret: "Daily Spin is being set up. Check back soon.",
  off: "Daily Spin is paused right now. Check back soon.",
  not_started: "Daily Spin hasn't started yet.",
};

function useWallClock() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const pct = (ppm: number) => `${(ppm / 10_000).toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;
const whole = (s: string) => Number(s).toLocaleString("en-US");

export default function SpinPage() {
  const { address } = useAccount();
  const { data: info, isError } = useRewardsInfo();
  const { data: player } = usePlayerRewards(address);

  return (
    <div className="space-y-10">
      <header className="animate-rise text-center">
        <p className="eyebrow text-xs text-red">Holders only</p>
        <h1 className="mt-2 font-display text-4xl font-black sm:text-5xl">Daily Spin</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted">
          Hold at least <b className="text-ink">{whole(info?.settings.minHoldTokens ?? "2000000")} RIVL</b> for{" "}
          {info?.settings.minHoldHours ?? 12} hours and spin the wheel once a day for free — fee-free wins, XP,
          cosmetics and RIVL prizes. Resets at 00:00 UTC.
        </p>
      </header>

      {isError && <p className="text-center text-sm text-red">Daily Spin is unavailable right now. Try again in a moment.</p>}
      {info && <SpinArena info={info} player={player} address={address} />}
      {info && <Odds info={info} />}
      {info && <CosmeticsGallery info={info} player={player} />}
      {info && <Fairness info={info} player={player} />}
    </div>
  );
}

function SpinArena({ info, player, address }: { info: RewardsInfo; player?: PlayerRewards; address?: Address }) {
  const queryClient = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const now = useWallClock();
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ticks = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => ticks.current.forEach(clearTimeout), []);

  // Sudah spin hari ini (mis. halaman dibuka ulang): roda langsung menunjuk hasilnya.
  const today = player?.today ?? null;
  const shownToday = useRef(false);
  useEffect(() => {
    if (today && !shownToday.current && !spinning) {
      shownToday.current = true;
      setRotation(targetRotation(0, today.prize) % 360);
    }
  }, [today, spinning]);

  const animate = (spin: SpinResult) => {
    const target = targetRotation(rotation, spin.prize);
    setSpinning(true);
    setRotation(target);
    // "Tik" yang melambat seperti roda sungguhan.
    let t = 0;
    for (let i = 0; i < 22; i++) {
      t += 60 + i * i * 0.75;
      ticks.current.push(setTimeout(() => sfx.tick(), t));
    }
    ticks.current.push(
      setTimeout(() => {
        setSpinning(false);
        setResult(spin);
        if (spin.prize === "try_again") sfx.neutral();
        else if (spin.prize === "jackpot" || spin.prize.startsWith("rivl")) {
          sfx.match();
          setTimeout(() => sfx.win(), 500);
        } else sfx.win();
        void queryClient.invalidateQueries({ queryKey: ["rewards"] });
      }, 4_700),
    );
  };

  const spin = async () => {
    if (!address) return;
    setError(null);
    setBusy(true);
    try {
      const signature = await signMessageAsync({ message: spinMessage(address, info.day) });
      const { spin } = await post<{ spin: SpinResult }>("/spin", { address, signature });
      animate(spin);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(/reject|denied|cancel/i.test(msg) ? "Signature cancelled in your wallet." : msg);
    } finally {
      setBusy(false);
    }
  };

  const elig = player?.eligibility;
  const decimals = info.token?.decimals ?? 18;
  let action: React.ReactNode;
  if (info.blocker) {
    action = <p className="text-center text-sm text-muted" data-testid="spin-blocked">{BLOCKER_TEXT[info.blocker]}</p>;
  } else if (!address) {
    action = (
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-muted">Connect the wallet that holds your RIVL.</p>
        <ConnectButton />
      </div>
    );
  } else if (!player) {
    action = <p className="text-center text-sm text-muted">Checking your wallet…</p>;
  } else if (player.today && !spinning) {
    action = (
      <div className="text-center" data-testid="spin-done">
        <p className="text-sm text-muted">You&apos;ve spun today. Next spin in</p>
        <p className="tabular font-display text-3xl font-black">{formatDuration(player.nextResetAt - now)}</p>
      </div>
    );
  } else if (elig && !elig.eligible) {
    const have = BigInt(elig.balance);
    const need = BigInt(elig.required);
    const progress = need === 0n ? 100 : Number((have * 100n) / need);
    action = (
      <div className="w-full max-w-sm space-y-2 text-center" data-testid="spin-locked">
        <div className="flex justify-between text-xs text-muted">
          <span>Your RIVL</span>
          <span className="tabular">
            {formatAmount(have, decimals, 0)} / {formatAmount(need, decimals, 0)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-red" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
        <p className="text-sm text-muted">
          {have < need
            ? `Hold at least ${formatAmount(need, decimals, 0)} RIVL to unlock the spin.`
            : elig.eligibleAt
              ? `Keep holding — unlocks in ${formatDuration(elig.eligibleAt - now)}.`
              : "Keep holding to unlock the spin."}
        </p>
      </div>
    );
  } else {
    action = (
      <Button size="lg" className="min-w-56" onClick={spin} loading={busy} disabled={spinning} data-testid="spin-button">
        {spinning ? "Spinning…" : "Spin now — free"}
      </Button>
    );
  }

  return (
    <section className="grid items-center gap-8 lg:grid-cols-[1fr_1fr]">
      <div className="relative py-4">
        <SpinWheel rotation={rotation} spinning={spinning} />
      </div>
      <div className="flex flex-col items-center gap-5 lg:items-start">
        {action}
        {error && (
          <p className="text-sm text-red" role="alert">
            {error}
          </p>
        )}
        {(result ?? (spinning ? null : today)) && <ResultCard spin={(result ?? today)!} info={info} fresh={!!result} />}
        {player && <MiniStats player={player} info={info} />}
      </div>
    </section>
  );
}

function ResultCard({ spin, info, fresh }: { spin: SpinResult; info: RewardsInfo; fresh: boolean }) {
  const item = spin.cosmetic ? info.cosmetics.find((c) => c.id === spin.cosmetic) : undefined;
  const big = spin.prize === "jackpot" || spin.prize.startsWith("rivl");
  const text: Record<Prize, string> = {
    try_again: "No prize this time. Come back tomorrow — a prize is guaranteed after a streak of misses.",
    fee_free_1: "Your next winning duel is fee-free. The fee is refunded in your weekly claim.",
    fee_free_3: "Your next 3 winning duels are fee-free. Fees are refunded in your weekly claim.",
    xp_50: "XP added to your profile.",
    xp_150: "XP added to your profile.",
    cosmetic: "New cosmetic unlocked! Equip it on your profile.",
    rivl_10k: "Added to your weekly claim on My duels.",
    rivl_50k: "Added to your weekly claim on My duels.",
    jackpot: "JACKPOT! Added to your weekly claim on My duels.",
  };
  return (
    <Card
      className={`w-full max-w-md p-5 ${fresh ? "animate-pop" : ""} ${big ? "border-[#ffc94d]/60 shadow-[0_0_60px_-20px_#ffc94d]" : ""}`}
    >
      <div data-testid="spin-result" data-prize={spin.prize}>
        <p className="eyebrow text-xs text-muted">{fresh ? "You won" : "Today's spin"}</p>
        <p className={`mt-1 font-display text-3xl font-black ${big ? "text-[#ffc94d]" : ""}`}>{PRIZE_LABEL[spin.prize]}</p>
        {item && (
          <div className="mt-3 flex items-center gap-3">
            <CosmeticPreview item={item} />
            <div>
              <p className="font-bold">{item.name}</p>
              <p className={`text-xs ${RARITY_STYLE[item.rarity].text}`}>
                {RARITY_STYLE[item.rarity].label} {item.kind}
              </p>
            </div>
          </div>
        )}
        <p className="mt-2 text-sm text-muted">{text[spin.prize]}</p>
        {spin.rolled !== spin.prize && (
          <p className="mt-1 text-xs text-faint">
            Rolled {PRIZE_LABEL[spin.rolled]} — {spin.rolled === "jackpot" ? "this week's jackpot is already won" : "limit reached"}, so it became{" "}
            {PRIZE_LABEL[spin.prize]}.
          </p>
        )}
        {spin.pity && <p className="mt-1 text-xs text-faint">Streak bonus: this spin was guaranteed a prize.</p>}
        {(spin.prize === "cosmetic" || big || spin.prize.startsWith("fee")) && (
          <Link href="/me#rewards" className="mt-3 inline-block text-sm font-semibold text-blue-bright hover:underline">
            Go to my rewards →
          </Link>
        )}
      </div>
    </Card>
  );
}

function MiniStats({ player, info }: { player: PlayerRewards; info: RewardsInfo }) {
  const into = player.xp % player.levelXp;
  const rivl = player.earned.find((e) => e.token.toLowerCase() === info.token?.address.toLowerCase());
  return (
    <div className="grid w-full max-w-md grid-cols-3 gap-2 text-center">
      <div className="rounded-xl border border-line bg-surface/80 p-3">
        <p className="eyebrow text-[10px] text-muted">Level</p>
        <p className="tabular font-display text-2xl font-black">{player.level}</p>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-raised">
          <div className="h-full bg-blue" style={{ width: `${(into / player.levelXp) * 100}%` }} />
        </div>
        <p className="tabular mt-1 text-[10px] text-faint">{player.xp} XP</p>
      </div>
      <div className="rounded-xl border border-line bg-surface/80 p-3">
        <p className="eyebrow text-[10px] text-muted">Fee-free wins</p>
        <p className="tabular font-display text-2xl font-black">{player.vouchers.remaining}</p>
      </div>
      <div className="rounded-xl border border-line bg-surface/80 p-3">
        <p className="eyebrow text-[10px] text-muted">RIVL won</p>
        <p className="tabular font-display text-2xl font-black">
          {rivl ? formatAmount(BigInt(rivl.amount), info.token?.decimals ?? 18, 0) : "0"}
        </p>
      </div>
    </div>
  );
}

function Odds({ info }: { info: RewardsInfo }) {
  const s = info.settings;
  const jackpotOn = info.odds.jackpot > 0;
  return (
    <section>
      <SectionTitle>Prizes &amp; odds</SectionTitle>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {PRIZE_ORDER.map((p) => (
              <tr key={p} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-2.5 font-semibold">{PRIZE_LABEL[p]}</td>
                <td className="tabular px-4 py-2.5 text-right text-muted" data-testid={`odds-${p}`}>
                  {p === "jackpot" && !jackpotOn ? (
                    <span>
                      0% <span className="text-xs">(launch week) → {pct(s.jackpotPpm)}</span>
                    </span>
                  ) : (
                    pct(info.odds[p])
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <ul className="mt-3 space-y-1 text-xs text-muted">
        <li>• Jackpot: max {s.jackpotWeeklyMax} per week. A second jackpot roll in the same week pays 50,000 RIVL instead.</li>
        <li>• Weekly RIVL budget: {whole(s.weeklyRivlBudget)} RIVL. When it runs out, RIVL rolls become +150 XP until Monday.</li>
        <li>• After {s.pityAfter} &ldquo;Try again&rdquo; in a row, your next spin is guaranteed a prize.</li>
        <li>• Fee-free wins refund the fee of your next winning duels (ETH or USDG) in the weekly claim.</li>
        <li>• Token prizes and refunds are claimed once a week on My duels — one transaction for everything.</li>
      </ul>
    </section>
  );
}

export function CosmeticPreview({ item, size = 44 }: { item: CosmeticInfo; size?: number }) {
  if (item.kind === "title") {
    const s = titleStyle(item.rarity);
    return (
      <span
        className={`grid shrink-0 place-items-center rounded-xl border border-line bg-raised px-1.5 text-center text-[9px] font-black uppercase leading-tight ${s.className}`}
        style={{ width: size * 2, height: size, ...s.style }}
      >
        {item.name}
      </span>
    );
  }
  return (
    <Avatar
      address="0x00000000000000000000000000000000000071f1"
      plain
      size={size}
      frame={item.kind === "frame" ? item.id : null}
      badge={item.kind === "badge" ? item.id : null}
    />
  );
}

function CosmeticsGallery({ info, player }: { info: RewardsInfo; player?: PlayerRewards }) {
  const owned = new Set(player?.inventory.map((i) => i.id));
  const known = info.cosmetics.filter((c) => FRAMES[c.id] || BADGES[c.id] || c.kind === "title");
  return (
    <section>
      <SectionTitle aside={player ? <span className="text-xs text-muted">{owned.size} / {known.length} owned</span> : undefined}>
        Cosmetics
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {known.map((c) => (
          <div
            key={c.id}
            className={`flex items-center gap-3 rounded-xl border bg-surface/80 p-3 ${RARITY_STYLE[c.rarity].border} ${
              player && !owned.has(c.id) ? "opacity-60" : ""
            }`}
            data-testid={`cosmetic-${c.id}`}
          >
            <CosmeticPreview item={c} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{c.name}</p>
              <p className={`text-[11px] ${RARITY_STYLE[c.rarity].text}`}>
                {RARITY_STYLE[c.rarity].label} {c.kind}
              </p>
              {!c.spin && <p className="text-[10px] text-faint">Jackpot winners only</p>}
              {owned.has(c.id) && <Badge tone="blue">Owned</Badge>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function verifyRoll(seed: Hex, wallet: Address, day: string): number {
  const h = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "string" }], [seed, wallet, day]));
  return Number(BigInt(h) % 1_000_000n);
}

function Fairness({ info, player }: { info: RewardsInfo; player?: PlayerRewards }) {
  return (
    <section>
      <SectionTitle>Provably fair</SectionTitle>
      <Card className="space-y-3 p-5 text-sm">
        <p className="text-muted">
          Every day has a secret seed. Its hash is published <b className="text-ink">before</b> the day starts, and the
          seed itself is revealed after the day ends, so nobody can change results after the fact. Your roll is{" "}
          <code className="text-ink">keccak256(abi.encode(seed, wallet, day)) mod 1,000,000</code>, mapped onto the
          odds table in order.
        </p>
        {info.fairness.commit && (
          <div className="space-y-1 font-mono text-xs">
            <p className="break-all">
              <span className="text-muted">Today ({info.fairness.day}) seed hash: </span>
              {info.fairness.commit}
            </p>
            <p className="break-all">
              <span className="text-muted">Tomorrow&apos;s seed hash: </span>
              {info.fairness.commitTomorrow}
            </p>
          </div>
        )}
        {player && player.history.length > 0 && (
          <div className="pt-2">
            <p className="eyebrow mb-2 text-[10px] text-muted">Your spins</p>
            <div className="space-y-1">
              {player.history.map((h) => (
                <HistoryRow key={h.day} spin={h} address={player.address} today={info.day} />
              ))}
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

function HistoryRow({ spin, address, today }: { spin: SpinResult; address: Address; today: string }) {
  const [check, setCheck] = useState(false);
  const { data } = useQuery({
    queryKey: ["rewards", "fairness", spin.day],
    enabled: check && spin.day < today,
    queryFn: () => fairnessOf(spin.day),
    staleTime: Infinity,
  });
  const ok = data?.seed ? verifyRoll(data.seed, address, spin.day) === spin.roll && keccak256(data.seed) === data.commit : undefined;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg/50 px-3 py-2 text-xs">
      <span className="tabular text-muted">{spin.day}</span>
      <span className="font-semibold">{PRIZE_LABEL[spin.prize]}</span>
      <span className="tabular text-faint">roll {spin.roll.toLocaleString("en-US")}</span>
      {spin.day >= today ? (
        <span className="text-faint">seed revealed tomorrow</span>
      ) : ok === undefined ? (
        <button type="button" onClick={() => setCheck(true)} className="font-semibold text-blue-bright hover:underline">
          Verify
        </button>
      ) : (
        <span className={ok ? "text-[#5eff8b]" : "text-red"}>{ok ? "✓ verified" : "✗ mismatch"}</span>
      )}
    </div>
  );
}

/**
 * API Daily Spin (dipasang di /rewards oleh src/api/index.ts).
 *
 *   GET  /rewards/info                    status fitur, peluang, katalog, seed commit hari ini
 *   GET  /rewards/player/:address         syarat hold, spin hari ini, XP, voucher, kosmetik, total hadiah
 *   POST /rewards/spin                    { address, signature } — satu kali per hari (UTC)
 *   GET  /rewards/fairness/:day           commit (selalu) dan seed (setelah hari selesai)
 *   GET  /rewards/cosmetics?addresses=…   kosmetik yang dipakai (untuk avatar di seluruh web)
 *   POST /rewards/equip                   { address, frame, badge, title, issuedAt, signature }
 *   GET  /rewards/proof/:address          bukti Merkle untuk root yang sedang aktif di RivlRewards
 *   POST /rewards/admin                   { action: "settings" | "prepare", data, issuedAt, signature } (owner)
 */
import { Hono, type Context } from "hono";
import { getAddress, isAddress, isHex, verifyMessage, zeroAddress, type Address, type Hex } from "viem";
import { rivlRewardsAbi } from "@rivl/contracts/abi";

import { client, ownerAbi, rivlMeta } from "./chain";
import { COSMETICS, cosmeticById } from "./cosmetics";
import { rewardsEnv } from "./env";
import { commitOf, dayOf, nextResetAt, seedOf, spinMessage, weekOf } from "./fairness";
import { eligibility, holdingsCursor, liveBalance, startHoldingsSync } from "./holdings";
import { buildTree, type Entry } from "./merkle";
import { effectiveOdds, getSettings, saveSettings, validateSettings, type Settings } from "./settings";
import { getSpin, performSpin, RIVL_PRIZES, XP_PRIZES, type SpinRow } from "./spin";
import { store } from "./store";
import { applyAllVouchers, applyVouchers } from "./vouchers";

const app = new Hono();
startHoldingsSync();

class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error("[rewards]", err);
  return c.json({ error: "Internal error" }, 500);
});

const nowSec = () => Math.floor(Date.now() / 1000);
const LEVEL_XP = 500;

function addr(v: unknown, name = "address"): Address {
  if (typeof v !== "string" || !isAddress(v)) throw new HttpError(400, `${name} must be a valid 0x address`);
  return getAddress(v);
}

/** Verifikasi tanda tangan (EOA maupun smart wallet ERC-1271/6492 lewat RPC). */
async function signedBy(address: Address, message: string, signature: unknown): Promise<boolean> {
  if (typeof signature !== "string" || !isHex(signature)) return false;
  try {
    if (await verifyMessage({ address, message, signature })) return true;
  } catch {
    /* lanjut ke cek smart wallet */
  }
  try {
    return await client.verifyMessage({ address, message, signature });
  } catch {
    return false;
  }
}

/** Kenapa spin belum bisa dipakai (null = siap). */
function blocker(s: Settings, now: number): string | null {
  if (!rewardsEnv.rivl) return "token";
  if (!rewardsEnv.spinSecret) return "secret";
  if (!s.enabled) return "off";
  if (s.launchAt !== null && now < s.launchAt) return "not_started";
  return null;
}

async function owner(): Promise<Address | undefined> {
  const target = rewardsEnv.rewards ?? rewardsEnv.arena;
  if (!target) return undefined;
  return client.readContract({ address: target, abi: ownerAbi, functionName: "owner" });
}

const publicSpin = (r: SpinRow) => ({
  day: r.day,
  roll: r.roll,
  rolled: r.rolled,
  prize: r.prize,
  xp: r.xp,
  amount: r.amount,
  cosmetic: r.cosmetic,
  vouchers: r.vouchers,
  pity: r.pity,
  odds: JSON.parse(r.odds) as Record<string, number>,
  createdAt: Number(r.created_at),
});

/** Total kumulatif hadiah per (akun, token): RIVL dari spin + pengembalian fee. */
async function earnedTotals(account?: string): Promise<Entry[]> {
  const s = await store();
  const where = account ? "where account = $1" : "";
  const params = account ? [account] : [];
  const rows = await s.query<{ account: string; token: string; total: string }>(
    `select account, token, sum(total)::text as total from (
       select account, token, amount as total from rivl_rewards.spin where amount is not null
       union all
       select account, token, fee as total from rivl_rewards.voucher_use
     ) t ${where} group by account, token order by account, token`,
    params,
  );
  return rows
    .filter((r) => BigInt(r.total) > 0n)
    .map((r) => ({ account: getAddress(r.account), token: getAddress(r.token), amount: BigInt(r.total) }));
}

// ---------------------------------------------------------------------------

app.get("/info", async (c) => {
  const now = nowSec();
  const settings = await getSettings();
  const day = dayOf(now);
  const s = await store();
  const week = weekOf(now);
  const [weekly] = await s.query<{ rivl: string; jackpots: string }>(
    `select coalesce(sum(amount), 0)::text as rivl, count(*) filter (where prize = 'jackpot')::text as jackpots
     from rivl_rewards.spin where week = $1`,
    [week],
  );
  const meta = rewardsEnv.rivl ? await rivlMeta().catch(() => ({ decimals: 18, symbol: "RIVL" })) : { decimals: 18, symbol: "RIVL" };
  const cursor = rewardsEnv.rivl ? await holdingsCursor() : undefined;
  let commit: Hex | null = null;
  let commitTomorrow: Hex | null = null;
  if (rewardsEnv.spinSecret) {
    commit = commitOf(seedOf(day));
    commitTomorrow = commitOf(seedOf(dayOf(nextResetAt(now))));
  }
  return c.json({
    blocker: blocker(settings, now),
    now,
    day,
    week,
    nextResetAt: nextResetAt(now),
    token: rewardsEnv.rivl ? { address: rewardsEnv.rivl, ...meta } : null,
    rewards: rewardsEnv.rewards ?? null,
    settings,
    odds: effectiveOdds(settings, now),
    prizes: { rivl: Object.fromEntries(Object.entries(RIVL_PRIZES).map(([k, v]) => [k, v!.toString()])), xp: XP_PRIZES },
    weekly: { rivlAwarded: weekly?.rivl ?? "0", jackpots: Number(weekly?.jackpots ?? 0) },
    holdingsSyncedAt: cursor?.ts ?? null,
    fairness: { day, commit, commitTomorrow },
    cosmetics: COSMETICS,
  });
});

app.get("/player/:address", async (c) => {
  const address = addr(c.req.param("address"));
  const a = address.toLowerCase();
  const now = nowSec();
  const settings = await getSettings();
  const meta = await rivlMeta().catch(() => ({ decimals: 18, symbol: "RIVL" }));
  const unit = 10n ** BigInt(meta.decimals);
  const cursor = rewardsEnv.rivl ? await holdingsCursor() : undefined;
  const elig = rewardsEnv.rivl
    ? await eligibility(address, BigInt(settings.minHoldTokens) * unit, settings.minHoldHours * 3600, Math.max(now, cursor?.ts ?? 0))
    : null;
  const s = await store();
  const history = await s.query<SpinRow>("select * from rivl_rewards.spin where account = $1 order by day desc limit 30", [a]);
  const [xpRow] = await s.query<{ xp: string }>("select coalesce(sum(xp), 0)::text as xp from rivl_rewards.spin where account = $1", [a]);
  const inventory = await s.query<{ cosmetic: string; acquired_at: string }>(
    "select cosmetic, acquired_at from rivl_rewards.inventory where account = $1 order by acquired_at desc",
    [a],
  );
  const [equipped] = await s.query<{ frame: string | null; badge: string | null; title: string | null }>(
    "select frame, badge, title from rivl_rewards.equipped where account = $1",
    [a],
  );
  const vouchers = await applyVouchers(a);
  const rebates = await s.query<{ duel_id: string; token: string; fee: string; used_at: string }>(
    "select duel_id, token, fee::text as fee, used_at from rivl_rewards.voucher_use where account = $1 order by used_at desc limit 30",
    [a],
  );
  const xp = Number(xpRow?.xp ?? 0);
  const today = history.find((h) => h.day === dayOf(now));
  return c.json({
    address,
    now,
    blocker: blocker(settings, now),
    eligibility: elig && {
      balance: elig.balance.toString(),
      required: elig.required.toString(),
      holdSince: elig.holdSince,
      eligibleAt: elig.eligibleAt,
      eligible: elig.eligible,
    },
    today: today ? publicSpin(today) : null,
    nextResetAt: nextResetAt(now),
    history: history.map(publicSpin),
    xp,
    level: Math.floor(xp / LEVEL_XP) + 1,
    levelXp: LEVEL_XP,
    vouchers: { earned: vouchers.earned, used: vouchers.used, remaining: vouchers.earned - vouchers.used },
    rebates: rebates.map((r) => ({ duelId: r.duel_id, token: r.token, fee: r.fee, usedAt: Number(r.used_at) })),
    inventory: inventory.map((i) => ({ id: i.cosmetic, acquiredAt: Number(i.acquired_at) })),
    equipped: equipped ?? { frame: null, badge: null, title: null },
    earned: (await earnedTotals(a)).map((e) => ({ token: e.token, amount: e.amount.toString() })),
  });
});

app.post("/spin", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { address?: string; signature?: string };
  const address = addr(body.address);
  const now = nowSec();
  const settings = await getSettings();
  const why = blocker(settings, now);
  if (why) throw new HttpError(409, `Daily Spin is not open (${why})`);
  const day = dayOf(now);
  if (!(await signedBy(address, spinMessage(address, day), body.signature))) throw new HttpError(401, "Invalid signature for today's spin");

  const done = await getSpin(address, day);
  if (done) return c.json({ spin: publicSpin(done), already: true });

  const meta = await rivlMeta();
  const required = BigInt(settings.minHoldTokens) * 10n ** BigInt(meta.decimals);
  const cursor = await holdingsCursor();
  const head = await client.getBlock({ blockTag: "latest" });
  if (!cursor || Number(head.timestamp) - cursor.ts > 600) throw new HttpError(503, "Holder balances are still syncing, try again in a minute");
  const elig = await eligibility(address, required, settings.minHoldHours * 3600, Math.max(now, cursor.ts));
  if (elig.balance < required || (await liveBalance(address)) < required) {
    throw new HttpError(403, `This wallet holds less than ${Number(settings.minHoldTokens).toLocaleString("en-US")} ${meta.symbol}`);
  }
  if (!elig.eligible) throw new HttpError(403, `Hold ${meta.symbol} for ${settings.minHoldHours}h without dropping below the minimum to unlock the spin`);

  const spin = await performSpin(address, settings, now, Number(head.timestamp));
  return c.json({ spin: publicSpin(spin), already: false });
});

app.get("/fairness/:day", async (c) => {
  const day = c.req.param("day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, "day must be YYYY-MM-DD");
  if (!rewardsEnv.spinSecret) throw new HttpError(409, "Daily Spin is not configured");
  const seed = seedOf(day);
  const today = dayOf(nowSec());
  return c.json({ day, commit: commitOf(seed), seed: day < today ? seed : null });
});

app.get("/cosmetics", async (c) => {
  const list = (c.req.query("addresses") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => isAddress(s));
  if (list.length === 0) return c.json({ items: {} });
  if (list.length > 100) throw new HttpError(400, "max 100 addresses");
  const s = await store();
  const rows = await s.query<{ account: string; frame: string | null; badge: string | null; title: string | null }>(
    `select account, frame, badge, title from rivl_rewards.equipped where account = any($1::text[])`,
    [list],
  );
  return c.json({ items: Object.fromEntries(rows.map((r) => [r.account, { frame: r.frame, badge: r.badge, title: r.title }])) });
});

export const equipMessage = (address: Address, frame: string | null, badge: string | null, title: string | null, issuedAt: number) =>
  `Rivl: equip cosmetics\n\nWallet: ${address}\nFrame: ${frame ?? "none"}\nBadge: ${badge ?? "none"}\nTitle: ${title ?? "none"}\nIssued: ${issuedAt}`;

app.post("/equip", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const address = addr(body.address);
  const issuedAt = Number(body.issuedAt);
  if (!Number.isInteger(issuedAt) || Math.abs(nowSec() - issuedAt) > 600) throw new HttpError(400, "Signature expired, please try again");
  const pick = (k: "frame" | "badge" | "title") => {
    const v = body[k];
    if (v === null || v === undefined || v === "") return null;
    const item = typeof v === "string" ? cosmeticById.get(v) : undefined;
    if (!item || item.kind !== k) throw new HttpError(400, `Unknown ${k}`);
    return item.id;
  };
  const frame = pick("frame");
  const badge = pick("badge");
  const title = pick("title");
  if (!(await signedBy(address, equipMessage(address, frame, badge, title, issuedAt), body.signature))) {
    throw new HttpError(401, "Invalid signature");
  }
  const s = await store();
  const a = address.toLowerCase();
  const owned = new Set(
    (await s.query<{ cosmetic: string }>("select cosmetic from rivl_rewards.inventory where account = $1", [a])).map((r) => r.cosmetic),
  );
  for (const id of [frame, badge, title]) if (id && !owned.has(id)) throw new HttpError(403, "You don't own that item yet");
  await s.query(
    `insert into rivl_rewards.equipped (account, frame, badge, title, updated_at) values ($1, $2, $3, $4, $5)
     on conflict (account) do update set frame = excluded.frame, badge = excluded.badge, title = excluded.title, updated_at = excluded.updated_at`,
    [a, frame, badge, title, nowSec()],
  );
  return c.json({ equipped: { frame, badge, title } });
});

app.get("/proof/:address", async (c) => {
  const address = addr(c.req.param("address"));
  if (!rewardsEnv.rewards) return c.json({ rewards: null, root: null, epoch: null, claims: [] });
  const [root, epoch] = await Promise.all([
    client.readContract({ address: rewardsEnv.rewards, abi: rivlRewardsAbi, functionName: "merkleRoot" }),
    client.readContract({ address: rewardsEnv.rewards, abi: rivlRewardsAbi, functionName: "epoch" }),
  ]);
  const s = await store();
  const [row] = await s.query<{ tree: string }>("select tree from rivl_rewards.epoch where root = $1 order by epoch desc limit 1", [root.toLowerCase()]);
  if (!row) return c.json({ rewards: rewardsEnv.rewards, root, epoch: Number(epoch), claims: [] });
  const tree = JSON.parse(row.tree) as { account: string; token: string; amount: string; proof: Hex[] }[];
  const claims = tree
    .filter((t) => t.account.toLowerCase() === address.toLowerCase())
    .map((t) => ({ token: t.token, cumulativeAmount: t.amount, proof: t.proof }));
  return c.json({ rewards: rewardsEnv.rewards, root, epoch: Number(epoch), claims });
});

export const adminMessage = (action: string, issuedAt: number, data: unknown) =>
  `Rivl rewards admin\n\nAction: ${action}\nIssued: ${issuedAt}\n\n${JSON.stringify(data)}`;

app.post("/admin", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { action?: string; issuedAt?: number; data?: unknown; signature?: string };
  const issuedAt = Number(body.issuedAt);
  if (!Number.isInteger(issuedAt) || Math.abs(nowSec() - issuedAt) > 600) throw new HttpError(400, "Signature expired, please try again");
  const who = await owner();
  if (!who || !(await signedBy(who, adminMessage(String(body.action), issuedAt, body.data ?? null), body.signature))) {
    throw new HttpError(403, "Only the owner can do this");
  }

  if (body.action === "settings") {
    let next: Settings;
    try {
      next = validateSettings(body.data);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : "Invalid settings");
    }
    await saveSettings(next);
    return c.json({ settings: next });
  }

  if (body.action === "prepare") {
    if (!rewardsEnv.rewards) throw new HttpError(409, "REWARDS_ADDRESS is not set");
    await applyAllVouchers();
    const entries = await earnedTotals();
    if (entries.length === 0) throw new HttpError(409, "No rewards to publish yet");
    const { root, proofs } = buildTree(entries);
    const onchainEpoch = await client.readContract({ address: rewardsEnv.rewards, abi: rivlRewardsAbi, functionName: "epoch" });
    const epoch = Number(onchainEpoch) + 1;
    const tree = entries.map((e, i) => ({ account: e.account, token: e.token, amount: e.amount.toString(), proof: proofs[i] }));
    const totals: Record<string, bigint> = {};
    for (const e of entries) totals[e.token] = (totals[e.token] ?? 0n) + e.amount;
    // Yang masih harus dibayar contract = total kumulatif − yang sudah diklaim.
    const owed: Record<string, string> = {};
    const balances: Record<string, string> = {};
    for (const token of Object.keys(totals) as Address[]) {
      let claimed = 0n;
      for (const e of entries.filter((x) => x.token === token)) {
        claimed += await client.readContract({
          address: rewardsEnv.rewards,
          abi: rivlRewardsAbi,
          functionName: "claimed",
          args: [e.account, token],
        });
      }
      owed[token] = (totals[token]! - claimed).toString();
      balances[token] = (
        token === zeroAddress
          ? await client.getBalance({ address: rewardsEnv.rewards })
          : await client.readContract({
              address: token,
              abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const,
              functionName: "balanceOf",
              args: [rewardsEnv.rewards],
            })
      ).toString();
    }
    const s = await store();
    await s.query(
      `insert into rivl_rewards.epoch (epoch, root, tree, totals, created_at) values ($1, $2, $3, $4, $5)
       on conflict (epoch) do update set root = excluded.root, tree = excluded.tree, totals = excluded.totals, created_at = excluded.created_at`,
      [epoch, root.toLowerCase(), JSON.stringify(tree), JSON.stringify(owed), nowSec()],
    );
    return c.json({ epoch, root, accounts: new Set(entries.map((e) => e.account)).size, owed, balances });
  }

  throw new HttpError(400, "Unknown action");
});

export default app;

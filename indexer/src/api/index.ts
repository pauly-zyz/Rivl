/**
 * HTTP API indexer (docs/spec.md bagian 4.2). Semua bilangan uint (amount, id, timestamp, dll.)
 * dikirim sebagai string desimal supaya tidak kehilangan presisi di JavaScript.
 *
 *   GET /duels/open                        duel terbuka & belum kedaluwarsa (filter + urutan)
 *   GET /duels/:id                         detail satu duel
 *   GET /duels?ids=1,2,3                   beberapa duel (selalu 200, yang belum terindeks dilewati)
 *   GET /players/:address/duels            riwayat duel satu alamat
 *   GET /players/:address/stats            menang / kalah / seri / volume
 *   GET /players/:address/pending-reveals  duel Suit milik alamat yang menunggu reveal
 *   GET /players/:address/withdrawals      riwayat penarikan
 *   GET /results/recent                    duel terakhir yang selesai (feed Live results)
 *   GET /stats                             statistik global
 *   /graphql, /sql/*                       akses umum bawaan Ponder
 */
import { db } from "ponder:api";
import schema, { GAMES, STATUSES } from "ponder:schema";
import { Hono, type Context } from "hono";
import { and, asc, client, desc, eq, gt, gte, graphql, inArray, lte, or, replaceBigInts, sql } from "ponder";
import { isAddress, zeroAddress, type Hex } from "viem";

const { duel } = schema;
const app = new Hono();

app.use("/graphql", graphql({ db, schema }));
app.use("/sql/*", client({ db, schema }));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

class BadRequest extends Error {}

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

function json(c: Context, data: unknown, status: 200 | 404 = 200) {
  return c.json(replaceBigInts(data, (v) => v.toString()) as object, status);
}

function parseAddress(value: string | undefined, name: string): Hex {
  if (!value || !isAddress(value)) throw new BadRequest(`${name} harus alamat 0x yang valid`);
  return value.toLowerCase() as Hex;
}

/** "ETH" atau alamat token. */
function parseToken(value: string): Hex {
  return value.toUpperCase() === "ETH" ? zeroAddress : parseAddress(value, "token");
}

function parseUint(value: string | undefined, name: string): bigint | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new BadRequest(`${name} harus bilangan bulat >= 0`);
  return BigInt(value);
}

function parsePaging(c: Context, defaultLimit: number, maxLimit: number) {
  const limit = Number(parseUint(c.req.query("limit"), "limit") ?? defaultLimit);
  const offset = Number(parseUint(c.req.query("offset"), "offset") ?? 0);
  if (limit < 1 || limit > maxLimit) throw new BadRequest(`limit harus 1–${maxLimit}`);
  return { limit, offset };
}

function parseEnum<T extends string>(value: string | undefined, allowed: readonly T[], name: string): T | undefined {
  if (value === undefined || value === "") return undefined;
  if (!allowed.includes(value as T)) throw new BadRequest(`${name} harus salah satu dari: ${allowed.join(", ")}`);
  return value as T;
}

function nowSeconds(c: Context): bigint {
  // Bisa di-override (mis. chain lokal yang waktunya dimajukan dengan evm_increaseTime).
  return parseUint(c.req.query("now"), "now") ?? BigInt(Math.floor(Date.now() / 1000));
}

const participant = (address: Hex) => or(eq(duel.creator, address), eq(duel.joiner, address));

// ---------------------------------------------------------------------------
// Duel
// ---------------------------------------------------------------------------

/**
 * Duel terbuka: status Open dan expiresAt > now.
 * Query: game, token (alamat atau "ETH"), minAmount, maxAmount (unit terkecil token),
 *        sort=newest|amount, limit (≤100), offset, now.
 */
app.get("/duels/open", async (c) => {
  const now = nowSeconds(c);
  const gameFilter = parseEnum(c.req.query("game"), GAMES, "game");
  const token = c.req.query("token");
  const minAmount = parseUint(c.req.query("minAmount"), "minAmount");
  const maxAmount = parseUint(c.req.query("maxAmount"), "maxAmount");
  const sort = parseEnum(c.req.query("sort"), ["newest", "amount"] as const, "sort") ?? "newest";
  const { limit, offset } = parsePaging(c, 50, 100);

  const where = and(
    eq(duel.status, "Open"),
    gt(duel.expiresAt, now),
    gameFilter ? eq(duel.game, gameFilter) : undefined,
    token ? eq(duel.token, parseToken(token)) : undefined,
    minAmount !== undefined ? gte(duel.amount, minAmount) : undefined,
    maxAmount !== undefined ? lte(duel.amount, maxAmount) : undefined,
  );
  const orderBy = sort === "amount" ? [desc(duel.amount), desc(duel.id)] : [desc(duel.createdAt), desc(duel.id)];

  const items = await db
    .select()
    .from(duel)
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);
  return json(c, { now, limit, offset, items });
});

/**
 * Beberapa duel sekaligus: /duels?ids=1,2,3 (maks. 100). Selalu 200; duel yang belum terindeks
 * (mis. baru saja dibuat) tidak muncul di `items`. Dipakai web supaya tidak ada 404 saat indexer tertinggal.
 */
app.get("/duels", async (c) => {
  const raw = c.req.query("ids") ?? "";
  const ids = raw
    .split(",")
    .filter(Boolean)
    .map((s) => parseUint(s.trim(), "ids")!);
  if (ids.length === 0 || ids.length > 100) throw new BadRequest("ids harus berisi 1–100 id, dipisah koma");
  const items = await db.select().from(duel).where(inArray(duel.id, ids));
  return json(c, { items });
});

app.get("/duels/:id", async (c) => {
  const id = parseUint(c.req.param("id"), "id")!;
  const [row] = await db.select().from(duel).where(eq(duel.id, id)).limit(1);
  if (!row) return json(c, { error: "Duel tidak ditemukan" }, 404);
  return json(c, row);
});

// ---------------------------------------------------------------------------
// Pemain
// ---------------------------------------------------------------------------

/** Riwayat duel alamat ini (sebagai pembuat atau penerima), terbaru dulu. Query: status, limit, offset. */
app.get("/players/:address/duels", async (c) => {
  const address = parseAddress(c.req.param("address"), "address");
  const status = parseEnum(c.req.query("status"), STATUSES, "status");
  const { limit, offset } = parsePaging(c, 50, 100);

  const items = await db
    .select()
    .from(duel)
    .where(and(participant(address), status ? eq(duel.status, status) : undefined))
    .orderBy(desc(duel.createdAt), desc(duel.id))
    .limit(limit)
    .offset(offset);
  return json(c, { address, limit, offset, items });
});

/**
 * Statistik pemain.
 * - wins / losses: duel Settled yang dimenangkan / dikalahkan
 * - draws: duel Draw (refund tanpa fee)
 * - volume per token: total taruhan alamat ini di duel yang sudah diterima lawan
 * - net per token: (payout yang dimenangkan) − (taruhan di duel Settled). Seri/refund/batal = 0.
 */
app.get("/players/:address/stats", async (c) => {
  const address = parseAddress(c.req.param("address"), "address");
  const won = sql`${duel.status} = 'Settled' and ${duel.winner} = ${address}`;
  const lost = sql`${duel.status} = 'Settled' and ${duel.winner} <> ${address}`;

  const rows = await db
    .select({
      token: duel.token,
      wins: sql<number>`count(*) filter (where ${won})`.mapWith(Number),
      losses: sql<number>`count(*) filter (where ${lost})`.mapWith(Number),
      draws: sql<number>`count(*) filter (where ${duel.status} = 'Draw')`.mapWith(Number),
      refunded: sql<number>`count(*) filter (where ${duel.status} = 'Refunded')`.mapWith(Number),
      cancelled: sql<number>`count(*) filter (where ${duel.status} = 'Cancelled')`.mapWith(Number),
      active: sql<number>`count(*) filter (where ${duel.status} in ('Open', 'AwaitingRandomness', 'AwaitingReveal'))`.mapWith(Number),
      volume: sql<string>`coalesce(sum(${duel.amount}) filter (where ${duel.joiner} is not null), 0)`,
      payoutWon: sql<string>`coalesce(sum(${duel.payout}) filter (where ${won}), 0)`,
      stakedSettled: sql<string>`coalesce(sum(${duel.amount}) filter (where ${duel.status} = 'Settled'), 0)`,
    })
    .from(duel)
    .where(participant(address))
    .groupBy(duel.token);

  const totals = { wins: 0, losses: 0, draws: 0, refunded: 0, cancelled: 0, active: 0 };
  const byToken = rows.map((r) => {
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];
    const payoutWon = BigInt(r.payoutWon);
    const stakedSettled = BigInt(r.stakedSettled);
    return {
      token: r.token,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      volume: BigInt(r.volume),
      payoutWon,
      net: payoutWon - stakedSettled,
    };
  });

  return json(c, { address, ...totals, byToken });
});

/** Duel Suit buatan alamat ini yang sudah diterima lawan dan menunggu reveal. Deadline terdekat dulu. */
app.get("/players/:address/pending-reveals", async (c) => {
  const address = parseAddress(c.req.param("address"), "address");
  const now = nowSeconds(c);

  const rows = await db
    .select()
    .from(duel)
    .where(and(eq(duel.game, "Suit"), eq(duel.creator, address), eq(duel.status, "AwaitingReveal")))
    .orderBy(asc(duel.deadline));

  const items = rows.map((r) => ({ ...r, expired: r.deadline !== null && r.deadline < now }));
  return json(c, { address, now, items });
});

/** Riwayat penarikan (`withdraw`) alamat ini, terbaru dulu. */
app.get("/players/:address/withdrawals", async (c) => {
  const address = parseAddress(c.req.param("address"), "address");
  const { limit, offset } = parsePaging(c, 50, 100);
  const items = await db
    .select()
    .from(schema.withdrawal)
    .where(eq(schema.withdrawal.user, address))
    .orderBy(desc(schema.withdrawal.blockNumber), desc(schema.withdrawal.id))
    .limit(limit)
    .offset(offset);
  return json(c, { address, limit, offset, items });
});

// ---------------------------------------------------------------------------
// Feed & statistik global
// ---------------------------------------------------------------------------

/** Duel yang selesai dengan hasil (Settled atau Draw), terbaru dulu. Query: limit (default 20, ≤50). */
app.get("/results/recent", async (c) => {
  const { limit } = parsePaging(c, 20, 50);
  const items = await db
    .select()
    .from(duel)
    .where(inArray(duel.status, ["Settled", "Draw"]))
    .orderBy(desc(duel.settledAt), desc(duel.id))
    .limit(limit);
  return json(c, { items });
});

/**
 * Statistik global.
 * - volume per token: total pot (2 × taruhan) duel yang sudah diterima lawan
 * - fees per token: total fee dari duel Settled
 */
app.get("/stats", async (c) => {
  const [perToken, perGame, perStatus] = await Promise.all([
    db
      .select({
        token: duel.token,
        duels: sql<number>`count(*)`.mapWith(Number),
        matched: sql<number>`count(*) filter (where ${duel.joiner} is not null)`.mapWith(Number),
        volume: sql<string>`coalesce(sum(${duel.amount} * 2) filter (where ${duel.joiner} is not null), 0)`,
        fees: sql<string>`coalesce(sum(${duel.fee}), 0)`,
      })
      .from(duel)
      .groupBy(duel.token),
    db.select({ game: duel.game, duels: sql<number>`count(*)`.mapWith(Number) }).from(duel).groupBy(duel.game),
    db.select({ status: duel.status, duels: sql<number>`count(*)`.mapWith(Number) }).from(duel).groupBy(duel.status),
  ]);

  return json(c, {
    totalDuels: perToken.reduce((n, r) => n + r.duels, 0),
    byToken: perToken.map((r) => ({ ...r, volume: BigInt(r.volume), fees: BigInt(r.fees) })),
    byGame: Object.fromEntries(perGame.map((r) => [r.game, r.duels])),
    byStatus: Object.fromEntries(perStatus.map((r) => [r.status, r.duels])),
  });
});

export default app;

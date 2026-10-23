/**
 * `pnpm demo` — mainkan duel di chain lokal, lalu buktikan indexer mengembalikan data yang benar.
 *
 * Butuh `pnpm dev` yang sedang berjalan (chain + indexer).
 *
 * Skenario (semua game: pembuat commit → penerima join → pembuat reveal):
 *   1. Coinflip ETH        dibuat, diterima dengan seed, di-reveal
 *   2. Dice USDG           approve → dibuat, diterima, di-reveal
 *   3. Suit ETH            commit → diterima → reveal → selesai
 *   4. Suit ETH            diterima, BELUM di-reveal   (muncul di pending-reveals)
 *   5. Coinflip USDG       dibiarkan terbuka           (muncul di daftar duel terbuka)
 *   6. Dice ETH            dibatalkan pembuat
 *   7. Dice ETH            seri (demo memilih seed bob dulu, lalu mencari salt yang membuat angka sama — hanya
 *                          bisa karena demo mengendalikan kedua pemain)
 *   8. Suit ETH            pembuat me-reveal pilihan tidak valid → penerima menang
 *   9. Coinflip ETH        pembuat tidak reveal → waktu dimajukan → claimRevealTimeout
 *  10. Suit ETH            pembuat tidak reveal → waktu dimajukan → claimRevealTimeout
 *  11. withdraw            semua saldo claimable pemain & treasury
 *
 * Skenario 9–10 memajukan waktu Anvil (evm_increaseTime) sekitar 1 jam per run.
 *
 * Lalu setiap query indexer dibandingkan dengan state contract (getDuel, claimable, event Withdrawn).
 */
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  parseEther,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { duelArenaAbi } from "@rivl/contracts/abi";

import { envInt, envString, loadRootEnv } from "../lib/env.ts";
import { readLocalDeployment } from "../lib/deployments.ts";
import { logger } from "../lib/log.ts";
import { computeSuitCommit, randomSalt, randomWordOf, NO_MOVE, PAPER, ROCK, SCISSORS } from "../lib/suit.ts";

const log = logger("demo");

const GAMES = ["Coinflip", "Dice", "Suit"] as const;
const STATUSES = ["None", "Open", "AwaitingReveal", "Settled", "Draw", "Cancelled"] as const;
const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;
const MOVES = ["", "ROCK", "PAPER", "SCISSORS"];

loadRootEnv();
const d = readLocalDeployment();
const indexerUrl = envString("INDEXER_URL") ?? `http://localhost:${envInt("INDEXER_PORT", 42069)}`;
const chain = defineChain({
  id: d.chainId,
  name: "Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [d.rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(d.rpcUrl), pollingInterval: 200 });
const wallet = createWalletClient({ chain, transport: http(d.rpcUrl) });
const testClient = createTestClient({ chain, mode: "anvil", transport: http(d.rpcUrl) });
const arena = d.contracts.arena;
const usdg = d.contracts.usdg;
const [alice, bob, carol] = d.testAccounts as [Address, Address, Address];

// ---------------------------------------------------------------------------
// Helper chain
// ---------------------------------------------------------------------------

type Write = Parameters<typeof wallet.writeContract>[0];

async function tx(account: Address, req: Omit<Write, "account" | "chain">) {
  const hash = await wallet.writeContract({ ...req, account, chain } as Write);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`tx ${req.functionName} revert`);
  return receipt;
}

async function arenaTx(account: Address, functionName: string, args: readonly unknown[], value?: bigint) {
  return tx(account, { address: arena, abi: duelArenaAbi, functionName, args, value } as never);
}

function getDuel(id: bigint) {
  return publicClient.readContract({ address: arena, abi: duelArenaAbi, functionName: "getDuel", args: [id] });
}

async function createdId(account: Address, functionName: string, args: readonly unknown[], value?: bigint) {
  const before = await publicClient.readContract({ address: arena, abi: duelArenaAbi, functionName: "nextDuelId" });
  await arenaTx(account, functionName, args, value);
  return before;
}

/** Commit Coinflip/Dice baru untuk `creator` (move = NO_MOVE). */
function coinDiceCommit(creator: Address, salt = randomSalt()) {
  return { salt, commit: computeSuitCommit({ chainId: d.chainId, arena, creator, move: NO_MOVE, salt }) };
}

/** Status duel setelah pembuat reveal. */
async function reveal(creator: Address, id: bigint, move: number, salt: Hex) {
  await arenaTx(creator, "reveal", [id, move, salt]);
  return STATUSES[(await getDuel(id)).status]!;
}

function fmt(token: string, amount: bigint | string) {
  const isEth = getAddress(token) === zeroAddress;
  return `${formatUnits(BigInt(amount), isEth ? 18 : d.usdgDecimals)} ${isEth ? "ETH" : "USDG"}`;
}

const short = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "-");
const name = (a: string | null | undefined) =>
  !a ? "-" : a.toLowerCase() === alice.toLowerCase() ? "alice" : a.toLowerCase() === bob.toLowerCase() ? "bob" : short(a);

// ---------------------------------------------------------------------------
// Helper indexer
// ---------------------------------------------------------------------------

async function api<T = any>(path: string): Promise<T> {
  const res = await fetch(indexerUrl + path);
  const body = await res.json();
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}

async function waitForIndexer() {
  const target = Number(await publicClient.getBlockNumber());
  for (let i = 0; i < 150; i++) {
    try {
      const status = await api<Record<string, { block: { number: number } }>>("/status");
      const indexed = Object.values(status)[0]?.block.number ?? 0;
      if (indexed >= target) return target;
    } catch {
      /* indexer belum siap */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Indexer di ${indexerUrl} belum mencapai blok ${target}. Apakah pnpm dev berjalan?`);
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  log.info(`  ${ok ? "✔" : "✘ GAGAL"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function play() {
  log.info(`Arena ${arena} · alice ${short(alice)} · bob ${short(bob)}`);

  // 1. Coinflip ETH
  const c1 = coinDiceCommit(alice);
  const cf = await createdId(alice, "createCoinflip", [zeroAddress, parseEther("0.01"), 0, c1.commit], parseEther("0.01"));
  await arenaTx(bob, "join", [cf, 0, randomSalt()], parseEther("0.01"));
  const cfStatus = await reveal(alice, cf, NO_MOVE, c1.salt);
  const cfDuel = await getDuel(cf);
  log.info(`#${cf} Coinflip 0.01 ETH: alice HEADS vs bob TAILS → ${cfDuel.creatorResult === 0 ? "HEADS" : "TAILS"}, ${cfStatus}, pemenang ${name(cfDuel.winner)}`);

  // 2. Dice USDG (dengan approve)
  const stake = parseUnits("25", d.usdgDecimals);
  for (const who of [alice, bob]) {
    await tx(who, { address: usdg, abi: erc20Abi, functionName: "approve", args: [arena, stake] });
  }
  const c2 = coinDiceCommit(alice);
  const dice = await createdId(alice, "createDice", [usdg, stake, c2.commit]);
  await arenaTx(bob, "join", [dice, 0, randomSalt()]);
  const diceStatus = await reveal(alice, dice, NO_MOVE, c2.salt);
  const diceDuel = await getDuel(dice);
  log.info(`#${dice} Dice 25 USDG: alice ${diceDuel.creatorResult} vs bob ${diceDuel.joinerResult} → ${diceStatus}${diceStatus === "Settled" ? `, pemenang ${name(diceDuel.winner)}` : ""}`);

  // 3. Suit ETH sampai reveal
  const salt = randomSalt();
  const commit = computeSuitCommit({ chainId: d.chainId, arena, creator: alice, move: ROCK, salt });
  const suit = await createdId(alice, "createSuit", [zeroAddress, parseEther("0.02"), commit], parseEther("0.02"));
  await arenaTx(bob, "join", [suit, PAPER, ZERO_HASH], parseEther("0.02"));
  await reveal(alice, suit, ROCK, salt);
  const suitDuel = await getDuel(suit);
  log.info(`#${suit} Suit 0.02 ETH: alice ROCK vs bob PAPER → ${STATUSES[suitDuel.status]}, pemenang ${name(suitDuel.winner)}`);

  // 4. Suit menunggu reveal
  const salt2 = randomSalt();
  const commit2 = computeSuitCommit({ chainId: d.chainId, arena, creator: alice, move: SCISSORS, salt: salt2 });
  const pending = await createdId(alice, "createSuit", [zeroAddress, parseEther("0.005"), commit2], parseEther("0.005"));
  await arenaTx(bob, "join", [pending, ROCK, ZERO_HASH], parseEther("0.005"));
  log.info(`#${pending} Suit 0.005 ETH: bob memilih ROCK, alice belum reveal (AwaitingReveal)`);

  // 5. Coinflip USDG dibiarkan terbuka
  const openStake = parseUnits("10", d.usdgDecimals);
  await tx(alice, { address: usdg, abi: erc20Abi, functionName: "approve", args: [arena, openStake] });
  const open = await createdId(alice, "createCoinflip", [usdg, openStake, 1, coinDiceCommit(alice).commit]);
  log.info(`#${open} Coinflip 10 USDG TAILS: dibiarkan terbuka`);

  // 6. Dice ETH dibatalkan
  const cancelled = await createdId(bob, "createDice", [zeroAddress, parseEther("0.005"), coinDiceCommit(bob).commit], parseEther("0.005"));
  await arenaTx(bob, "cancel", [cancelled]);
  log.info(`#${cancelled} Dice 0.005 ETH: dibatalkan bob`);

  // 7. Dice seri. Hanya demo yang bisa begini: demo memegang kedua pemain, jadi memilih seed bob dulu
  //    lalu mencari salt alice yang membuat kedua angka sama. Pemain sungguhan tidak tahu seed lawan saat commit.
  const drawSeed = randomSalt();
  let drawSalt: Hex = randomSalt();
  for (let i = 0; ; i++) {
    const w = randomWordOf(drawSalt, drawSeed);
    if (((w & ((1n << 128n) - 1n)) % 100n) === ((w >> 128n) % 100n)) break;
    if (i > 100_000) throw new Error("salt seri tidak ditemukan");
    drawSalt = randomSalt();
  }
  const drawCommit = coinDiceCommit(alice, drawSalt);
  const draw = await createdId(alice, "createDice", [zeroAddress, parseEther("0.01"), drawCommit.commit], parseEther("0.01"));
  await arenaTx(bob, "join", [draw, 0, drawSeed], parseEther("0.01"));
  const drawStatus = await reveal(alice, draw, NO_MOVE, drawSalt);
  const drawDuel = await getDuel(draw);
  log.info(`#${draw} Dice 0.01 ETH: alice ${drawDuel.creatorResult} vs bob ${drawDuel.joinerResult} → ${drawStatus}`);

  // 8. Suit dengan pilihan tidak valid (4) di commit → penerima menang saat reveal
  const salt3 = randomSalt();
  const invalid = await createdId(
    alice,
    "createSuit",
    [zeroAddress, parseEther("0.005"), computeSuitCommit({ chainId: d.chainId, arena, creator: alice, move: 4, salt: salt3 })],
    parseEther("0.005"),
  );
  await arenaTx(bob, "join", [invalid, SCISSORS, ZERO_HASH], parseEther("0.005"));
  await reveal(alice, invalid, 4, salt3);
  log.info(`#${invalid} Suit 0.005 ETH: alice me-reveal move 4 (tidak valid) → pemenang ${name((await getDuel(invalid)).winner)}`);

  // 9 & 10. Timeout: pembuat tidak reveal, waktu chain dimajukan melewati jendela reveal.
  const timeoutSuit = await createdId(
    alice,
    "createSuit",
    [zeroAddress, parseEther("0.005"), computeSuitCommit({ chainId: d.chainId, arena, creator: alice, move: PAPER, salt: randomSalt() })],
    parseEther("0.005"),
  );
  await arenaTx(bob, "join", [timeoutSuit, ROCK, ZERO_HASH], parseEther("0.005"));
  const timeoutCoin = await createdId(alice, "createCoinflip", [zeroAddress, parseEther("0.005"), 0, coinDiceCommit(alice).commit], parseEther("0.005"));
  await arenaTx(bob, "join", [timeoutCoin, 0, randomSalt()], parseEther("0.005"));
  const revealWindow = await publicClient.readContract({ address: arena, abi: duelArenaAbi, functionName: "revealWindow" });
  await testClient.increaseTime({ seconds: Number(revealWindow) + 1 });
  await testClient.mine({ blocks: 1 });
  await arenaTx(carol, "claimRevealTimeout", [timeoutCoin]);
  await arenaTx(carol, "claimRevealTimeout", [timeoutSuit]);
  log.info(`waktu chain dimajukan ${Number(revealWindow) + 1} detik`);
  log.info(`#${timeoutCoin} Coinflip 0.005 ETH: alice tidak reveal → pemenang ${name((await getDuel(timeoutCoin)).winner)} (dipicu pihak ketiga)`);
  log.info(`#${timeoutSuit} Suit 0.005 ETH: alice tidak reveal → pemenang ${name((await getDuel(timeoutSuit)).winner)} (claimRevealTimeout)`);

  // 11. Withdraw semua saldo
  for (const who of [alice, bob, d.treasury]) {
    for (const token of [zeroAddress, usdg] as Address[]) {
      const amount = await publicClient.readContract({
        address: arena,
        abi: duelArenaAbi,
        functionName: "claimable",
        args: [who, token],
      });
      if (amount > 0n) {
        await arenaTx(who, "withdraw", [token]);
        log.info(`withdraw ${who === d.treasury ? "treasury" : name(who)}: ${fmt(token, amount)}`);
      }
    }
  }

  return { cf, dice, suit, pending, open, cancelled, draw, invalid, timeoutCoin, timeoutSuit };
}

async function verify(ids: Awaited<ReturnType<typeof play>>) {
  const block = await waitForIndexer();
  log.info(`Indexer sinkron sampai blok ${block}. Membandingkan setiap query dengan state contract:`);

  // Semua duel di chain sebagai acuan.
  const next = await publicClient.readContract({ address: arena, abi: duelArenaAbi, functionName: "nextDuelId" });
  const chainDuels = new Map<bigint, Awaited<ReturnType<typeof getDuel>>>();
  for (let id = 1n; id < next; id++) chainDuels.set(id, await getDuel(id));
  const lc = (a: string) => a.toLowerCase();
  const orNull = (a: string) => (a === zeroAddress ? null : lc(a));

  // --- Detail duel: setiap duel di chain ---
  let detailOk = 0;
  for (const [id, c] of chainDuels) {
    const r = await api(`/duels/${id}`);
    const game = GAMES[c.game]!;
    const status = STATUSES[c.status]!;
    const expect: Record<string, unknown> = {
      game,
      status,
      token: lc(c.token),
      amount: c.amount.toString(),
      creator: lc(c.creator),
      joiner: orNull(c.joiner),
      winner: orNull(c.winner),
      expiresAt: c.expiresAt.toString(),
      deadline: c.deadline === 0n ? null : c.deadline.toString(),
      commit: c.commit,
      joinerSeed: game !== "Suit" && c.joiner !== zeroAddress ? c.joinerSeed : null,
      creatorChoice: game === "Coinflip" ? c.creatorChoice : null,
      joinerChoice: game === "Suit" && c.joiner !== zeroAddress ? c.joinerChoice : null,
    };
    // Salt terisi saat reveal; tanpa salt = belum/tidak pernah di-reveal.
    const revealed = c.salt !== ZERO_HASH;
    expect.revealedSalt = revealed ? c.salt : null;
    expect.revealedMove = revealed ? (game === "Suit" ? c.creatorChoice : NO_MOVE) : null;
    expect.revealTimedOut = status === "Settled" && !revealed;
    if (game !== "Suit" && revealed) {
      expect.randomWord = c.randomWord.toString();
      if (game === "Coinflip") expect.coinResult = c.creatorResult;
      if (game === "Dice") Object.assign(expect, { creatorRoll: c.creatorResult, joinerRoll: c.joinerResult });
    }
    if (status === "Settled") {
      const fee = (c.amount * 2n * BigInt(c.feeBpsAtCreate)) / 10_000n;
      Object.assign(expect, { fee: fee.toString(), payout: (c.amount * 2n - fee).toString() });
    }
    const diffs = Object.entries(expect).filter(([k, v]) => r[k] !== v);
    if (diffs.length === 0) detailOk++;
    else check(`/duels/${id}`, false, diffs.map(([k, v]) => `${k}: indexer=${r[k]} chain=${v}`).join("; "));
  }
  check(`/duels/:id — ${detailOk}/${chainDuels.size} duel identik dengan getDuel()`, detailOk === chainDuels.size);

  // --- Duel terbuka ---
  // Waktu chain (bisa lebih maju dari jam dinding karena evm_increaseTime).
  const now = (await publicClient.getBlock()).timestamp;
  const expectedOpen = [...chainDuels].filter(([, c]) => c.status === 1 && c.expiresAt > now).map(([id]) => id.toString());
  const openRes = await api(`/duels/open?now=${now}&limit=100`);
  const openIds = openRes.items.map((x: any) => x.id);
  check(
    `/duels/open — ${openIds.length} duel terbuka, sama dengan chain`,
    JSON.stringify([...openIds].sort()) === JSON.stringify([...expectedOpen].sort()),
    `indexer=${openIds} chain=${expectedOpen}`,
  );
  const filtered = await api(`/duels/open?game=Coinflip&token=${usdg}&minAmount=${parseUnits("10", 6)}&maxAmount=${parseUnits("10", 6)}&sort=amount`);
  check(`/duels/open?game=Coinflip&token=USDG&min=max=10 memuat duel #${ids.open}`, filtered.items.some((x: any) => x.id === ids.open.toString()));
  const noMatch = await api(`/duels/open?game=Dice&token=ETH`);
  check(`/duels/open?game=Dice&token=ETH tidak memuat Coinflip USDG #${ids.open}`, !noMatch.items.some((x: any) => x.id === ids.open.toString()));

  // --- Riwayat & statistik per alamat ---
  for (const [who, label] of [[alice, "alice"], [bob, "bob"]] as const) {
    const mine = [...chainDuels].filter(([, c]) => lc(c.creator) === lc(who) || lc(c.joiner) === lc(who));
    const hist = await api(`/players/${who}/duels?limit=100`);
    check(`/players/${label}/duels — ${hist.items.length} duel`, hist.items.length === Math.min(mine.length, 100), `chain=${mine.length}`);

    const settled = mine.filter(([, c]) => c.status === 3);
    const exp = {
      wins: settled.filter(([, c]) => lc(c.winner) === lc(who)).length,
      losses: settled.filter(([, c]) => lc(c.winner) !== lc(who)).length,
      draws: mine.filter(([, c]) => c.status === 4).length,
    };
    const stats = await api(`/players/${who}/stats`);
    check(
      `/players/${label}/stats — menang ${stats.wins}, kalah ${stats.losses}, seri ${stats.draws}`,
      stats.wins === exp.wins && stats.losses === exp.losses && stats.draws === exp.draws,
      `chain: ${JSON.stringify(exp)}`,
    );
    for (const t of stats.byToken) {
      const expVolume = mine
        .filter(([, c]) => lc(c.token) === t.token && c.joiner !== zeroAddress)
        .reduce((s, [, c]) => s + c.amount, 0n);
      check(`  volume ${label} ${fmt(t.token, t.volume)} (net ${t.net.startsWith("-") ? "-" : "+"}${fmt(t.token, t.net.replace("-", ""))})`, BigInt(t.volume) === expVolume, `chain=${expVolume}`);
    }

    const w = await api(`/players/${who}/withdrawals`);
    const events = await publicClient.getContractEvents({
      address: arena,
      abi: duelArenaAbi,
      eventName: "Withdrawn",
      args: { user: who },
      fromBlock: BigInt(d.startBlock),
    });
    check(`/players/${label}/withdrawals — ${w.items.length} penarikan`, w.items.length === Math.min(events.length, 50), `event Withdrawn=${events.length}`);
  }

  // --- Duel menunggu reveal (semua game) ---
  const expPending = [...chainDuels].filter(([, c]) => c.status === 2 && lc(c.creator) === lc(alice)).map(([id]) => id.toString());
  const pend = await api(`/players/${alice}/pending-reveals?now=${now}`);
  check(
    `/players/alice/pending-reveals — ${pend.items.length} duel (#${pend.items.map((x: any) => x.id).join(", #")})`,
    JSON.stringify(pend.items.map((x: any) => x.id).sort()) === JSON.stringify(expPending.sort()),
    `chain=${expPending}`,
  );
  const expiredOk = pend.items.every((x: any) => x.expired === BigInt(x.deadline) < now);
  check(`/players/alice/pending-reveals — flag expired sesuai deadline`, expiredOk);
  const pendBob = await api(`/players/${bob}/pending-reveals`);
  check(`/players/bob/pending-reveals — kosong (bob penerima, bukan pembuat)`, pendBob.items.length === 0);

  // --- Live results ---
  const finished = [...chainDuels].filter(([, c]) => c.status === 3 || c.status === 4);
  const recent = await api(`/results/recent`);
  check(
    `/results/recent — ${recent.items.length} hasil, terbaru #${recent.items[0]?.id}`,
    recent.items.length === Math.min(finished.length, 20) && recent.items.every((x: any) => ["Settled", "Draw"].includes(x.status)),
    `chain=${finished.length}`,
  );
  check(`/results/recent memuat duel Suit #${ids.suit} yang baru di-reveal`, recent.items.some((x: any) => x.id === ids.suit.toString()));

  // --- Jalur khusus ---
  const drawRow = await api(`/duels/${ids.draw}`);
  const drawChain = chainDuels.get(ids.draw)!;
  check(
    `/duels/${ids.draw} Dice seri: status ${drawRow.status}, angka ${drawRow.creatorRoll} vs ${drawRow.joinerRoll}, randomWord dari salt + seed`,
    drawRow.status === "Draw" &&
      drawRow.creatorRoll === drawRow.joinerRoll &&
      drawRow.randomWord === drawChain.randomWord.toString() &&
      drawRow.randomWord === randomWordOf(drawChain.salt, drawChain.joinerSeed).toString(),
  );
  const invalidRow = await api(`/duels/${ids.invalid}`);
  check(
    `/duels/${ids.invalid} Suit move tidak valid: revealedMove ${invalidRow.revealedMove}, pemenang ${name(invalidRow.winner)}`,
    invalidRow.revealedMove === 4 && invalidRow.winner === bob.toLowerCase() && invalidRow.revealTimedOut === false,
  );
  const coinTimeoutRow = await api(`/duels/${ids.timeoutCoin}`);
  check(
    `/duels/${ids.timeoutCoin} Coinflip tanpa reveal: revealTimedOut ${coinTimeoutRow.revealTimedOut}, pemenang ${name(coinTimeoutRow.winner)}, tanpa hasil koin`,
    coinTimeoutRow.revealTimedOut === true && coinTimeoutRow.winner === bob.toLowerCase() && coinTimeoutRow.coinResult === null,
  );
  const timeoutRow = await api(`/duels/${ids.timeoutSuit}`);
  check(
    `/duels/${ids.timeoutSuit} reveal timeout: revealTimedOut ${timeoutRow.revealTimedOut}, pemenang ${name(timeoutRow.winner)}`,
    timeoutRow.revealTimedOut === true && timeoutRow.winner === bob.toLowerCase() && timeoutRow.revealedMove === null,
  );

  // --- Statistik global ---
  const stats = await api(`/stats`);
  check(`/stats — total ${stats.totalDuels} duel`, stats.totalDuels === chainDuels.size, `chain=${chainDuels.size}`);
  for (const t of stats.byToken) {
    const ofToken = [...chainDuels].filter(([, c]) => lc(c.token) === t.token);
    const expVolume = ofToken.filter(([, c]) => c.joiner !== zeroAddress).reduce((s, [, c]) => s + c.amount * 2n, 0n);
    const expFees = ofToken
      .filter(([, c]) => c.status === 3)
      .reduce((s, [, c]) => s + (c.amount * 2n * BigInt(c.feeBpsAtCreate)) / 10_000n, 0n);
    check(
      `  ${fmt(t.token, 0n).split(" ")[1]}: ${t.duels} duel, volume ${fmt(t.token, t.volume)}, fee ${fmt(t.token, t.fees)}`,
      t.duels === ofToken.length && BigInt(t.volume) === expVolume && BigInt(t.fees) === expFees,
      `chain: duels=${ofToken.length} volume=${expVolume} fees=${expFees}`,
    );
  }

  // --- Contoh tampilan ---
  log.info("");
  log.info("Contoh respons /duels/" + ids.dice + ":");
  console.log(JSON.stringify(await api(`/duels/${ids.dice}`), null, 2));
  log.info("Contoh respons /stats:");
  console.log(JSON.stringify(stats, null, 2));
}

play()
  .then(verify)
  .then(() => {
    log.info("");
    if (failures) {
      log.error(`${failures} pemeriksaan GAGAL`);
      process.exit(1);
    }
    log.info("Semua pemeriksaan lulus: data indexer sama dengan state contract.");
  })
  .catch((err: unknown) => {
    log.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

/**
 * `pnpm demo` — mainkan duel di chain lokal, lalu buktikan indexer mengembalikan data yang benar.
 *
 * Butuh `pnpm dev` yang sedang berjalan (chain + auto-fulfill + indexer).
 *
 * Skenario:
 *   1. Coinflip ETH        dibuat, diterima, diselesaikan auto-fulfill
 *   2. Dice USDG           approve → dibuat, diterima, diselesaikan auto-fulfill
 *   3. Suit ETH            commit → diterima → reveal → selesai
 *   4. Suit ETH            diterima, BELUM di-reveal   (muncul di pending-reveals)
 *   5. Coinflip USDG       dibiarkan terbuka           (muncul di daftar duel terbuka)
 *   6. Dice ETH            dibatalkan pembuat
 *   7. Dice ETH            seri (randomWord dipilih demo lewat DevRandomnessProvider sebelum auto-fulfill)
 *   8. Suit ETH            pembuat me-reveal pilihan tidak valid → penerima menang
 *   9. Coinflip ETH        randomness "tidak datang" → waktu dimajukan → refundStuckRandomness
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
import { devRandomnessProviderAbi, duelArenaAbi } from "@rivl/contracts/abi";

import { envInt, envString, loadRootEnv } from "../lib/env.ts";
import { readLocalDeployment } from "../lib/deployments.ts";
import { logger } from "../lib/log.ts";
import { computeSuitCommit, randomSalt, PAPER, ROCK, SCISSORS } from "../lib/suit.ts";

const log = logger("demo");

const GAMES = ["Coinflip", "Dice", "Suit"] as const;
const STATUSES = ["None", "Open", "AwaitingRandomness", "AwaitingReveal", "Settled", "Draw", "Cancelled", "Refunded"] as const;
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

async function waitForRandomness(id: bigint) {
  for (let i = 0; i < 150; i++) {
    const s = STATUSES[(await getDuel(id)).status];
    if (s !== "AwaitingRandomness") return s;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`duel #${id} tidak diselesaikan auto-fulfill dalam 30 detik. Apakah pnpm dev berjalan?`);
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
  const cf = await createdId(alice, "createCoinflip", [zeroAddress, parseEther("0.01"), 0], parseEther("0.01"));
  await arenaTx(bob, "join", [cf, 0], parseEther("0.01"));
  const cfStatus = await waitForRandomness(cf);
  const cfDuel = await getDuel(cf);
  log.info(`#${cf} Coinflip 0.01 ETH: alice HEADS vs bob TAILS → ${cfDuel.creatorResult === 0 ? "HEADS" : "TAILS"}, ${cfStatus}, pemenang ${name(cfDuel.winner)}`);

  // 2. Dice USDG (dengan approve)
  const stake = parseUnits("25", d.usdgDecimals);
  for (const who of [alice, bob]) {
    await tx(who, { address: usdg, abi: erc20Abi, functionName: "approve", args: [arena, stake] });
  }
  const dice = await createdId(alice, "createDice", [usdg, stake]);
  await arenaTx(bob, "join", [dice, 0]);
  const diceStatus = await waitForRandomness(dice);
  const diceDuel = await getDuel(dice);
  log.info(`#${dice} Dice 25 USDG: alice ${diceDuel.creatorResult} vs bob ${diceDuel.joinerResult} → ${diceStatus}${diceStatus === "Settled" ? `, pemenang ${name(diceDuel.winner)}` : ""}`);

  // 3. Suit ETH sampai reveal
  const salt = randomSalt();
  const commit = computeSuitCommit({ chainId: d.chainId, arena, creator: alice, move: ROCK, salt });
  const suit = await createdId(alice, "createSuit", [zeroAddress, parseEther("0.02"), commit], parseEther("0.02"));
  await arenaTx(bob, "join", [suit, PAPER], parseEther("0.02"));
  await arenaTx(alice, "revealSuit", [suit, ROCK, salt]);
  const suitDuel = await getDuel(suit);
  log.info(`#${suit} Suit 0.02 ETH: alice ROCK vs bob PAPER → ${STATUSES[suitDuel.status]}, pemenang ${name(suitDuel.winner)}`);

  // 4. Suit menunggu reveal
  const salt2 = randomSalt();
  const commit2 = computeSuitCommit({ chainId: d.chainId, arena, creator: alice, move: SCISSORS, salt: salt2 });
  const pending = await createdId(alice, "createSuit", [zeroAddress, parseEther("0.005"), commit2], parseEther("0.005"));
  await arenaTx(bob, "join", [pending, ROCK], parseEther("0.005"));
  log.info(`#${pending} Suit 0.005 ETH: bob memilih ROCK, alice belum reveal (AwaitingReveal)`);

  // 5. Coinflip USDG dibiarkan terbuka
  const openStake = parseUnits("10", d.usdgDecimals);
  await tx(alice, { address: usdg, abi: erc20Abi, functionName: "approve", args: [arena, openStake] });
  const open = await createdId(alice, "createCoinflip", [usdg, openStake, 1]);
  log.info(`#${open} Coinflip 10 USDG TAILS: dibiarkan terbuka`);

  // 6. Dice ETH dibatalkan
  const cancelled = await createdId(bob, "createDice", [zeroAddress, parseEther("0.005")], parseEther("0.005"));
  await arenaTx(bob, "cancel", [cancelled]);
  log.info(`#${cancelled} Dice 0.005 ETH: dibatalkan bob`);

  // 7. Dice seri: demo memenuhi request sendiri (owner DevRandomnessProvider) sebelum jeda auto-fulfill habis.
  const draw = await createdId(alice, "createDice", [zeroAddress, parseEther("0.01")], parseEther("0.01"));
  await arenaTx(bob, "join", [draw, 0], parseEther("0.01"));
  const sameRoll = (41n << 128n) | 41n; // kedua pemain mendapat 42
  await tx(d.owner, {
    address: d.contracts.devRandomness,
    abi: devRandomnessProviderAbi,
    functionName: "fulfill",
    args: [(await getDuel(draw)).requestId, sameRoll],
  });
  log.info(`#${draw} Dice 0.01 ETH: alice 42 vs bob 42 → ${STATUSES[(await getDuel(draw)).status]}`);

  // 8. Suit dengan pilihan tidak valid (4) di commit → penerima menang saat reveal
  const salt3 = randomSalt();
  const invalid = await createdId(
    alice,
    "createSuit",
    [zeroAddress, parseEther("0.005"), computeSuitCommit({ chainId: d.chainId, arena, creator: alice, move: 4, salt: salt3 })],
    parseEther("0.005"),
  );
  await arenaTx(bob, "join", [invalid, SCISSORS], parseEther("0.005"));
  await arenaTx(alice, "revealSuit", [invalid, 4, salt3]);
  log.info(`#${invalid} Suit 0.005 ETH: alice me-reveal move 4 (tidak valid) → pemenang ${name((await getDuel(invalid)).winner)}`);

  // 9 & 10. Timeout: majukan waktu chain melewati batas randomness dan reveal.
  const timeoutSuit = await createdId(
    alice,
    "createSuit",
    [zeroAddress, parseEther("0.005"), computeSuitCommit({ chainId: d.chainId, arena, creator: alice, move: PAPER, salt: randomSalt() })],
    parseEther("0.005"),
  );
  await arenaTx(bob, "join", [timeoutSuit, ROCK], parseEther("0.005"));
  const refund = await createdId(alice, "createCoinflip", [zeroAddress, parseEther("0.005"), 0], parseEther("0.005"));
  await arenaTx(bob, "join", [refund, 0], parseEther("0.005"));
  // Dikerjakan dalam jeda auto-fulfill (AUTO_FULFILL_DELAY_MS), jadi randomness belum datang.
  const [randomnessTimeout, revealWindow] = await Promise.all([
    publicClient.readContract({ address: arena, abi: duelArenaAbi, functionName: "randomnessTimeout" }),
    publicClient.readContract({ address: arena, abi: duelArenaAbi, functionName: "revealWindow" }),
  ]);
  await testClient.increaseTime({ seconds: Number(randomnessTimeout > revealWindow ? randomnessTimeout : revealWindow) + 1 });
  await testClient.mine({ blocks: 1 });
  await arenaTx(carol, "refundStuckRandomness", [refund]);
  await arenaTx(carol, "claimRevealTimeout", [timeoutSuit]);
  log.info(`waktu chain dimajukan ${Number(randomnessTimeout > revealWindow ? randomnessTimeout : revealWindow) + 1} detik`);
  log.info(`#${refund} Coinflip 0.005 ETH: randomness tidak datang → ${STATUSES[(await getDuel(refund)).status]} (dipicu pihak ketiga)`);
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

  return { cf, dice, suit, pending, open, cancelled, draw, invalid, refund, timeoutSuit };
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
      requestId: c.requestId === 0n ? null : c.requestId.toString(),
      commit: game === "Suit" ? c.commit : null,
      creatorChoice: game === "Coinflip" ? c.creatorChoice : null,
      joinerChoice: game === "Suit" && c.joiner !== zeroAddress ? c.joinerChoice : null,
    };
    if (game !== "Suit" && (status === "Settled" || status === "Draw")) {
      expect.randomWord = c.randomWord.toString();
      if (game === "Coinflip") expect.coinResult = c.creatorResult;
      if (game === "Dice") Object.assign(expect, { creatorRoll: c.creatorResult, joinerRoll: c.joinerResult });
    }
    if (game === "Suit") {
      // creatorChoice di contract baru terisi saat reveal.
      expect.revealedMove = c.creatorChoice === 0 ? null : c.creatorChoice;
      expect.revealTimedOut = status === "Settled" && c.creatorChoice === 0;
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

    const settled = mine.filter(([, c]) => c.status === 4);
    const exp = {
      wins: settled.filter(([, c]) => lc(c.winner) === lc(who)).length,
      losses: settled.filter(([, c]) => lc(c.winner) !== lc(who)).length,
      draws: mine.filter(([, c]) => c.status === 5).length,
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

  // --- Suit menunggu reveal ---
  const expPending = [...chainDuels].filter(([, c]) => c.game === 2 && c.status === 3 && lc(c.creator) === lc(alice)).map(([id]) => id.toString());
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
  const finished = [...chainDuels].filter(([, c]) => c.status === 4 || c.status === 5);
  const recent = await api(`/results/recent`);
  check(
    `/results/recent — ${recent.items.length} hasil, terbaru #${recent.items[0]?.id}`,
    recent.items.length === Math.min(finished.length, 20) && recent.items.every((x: any) => ["Settled", "Draw"].includes(x.status)),
    `chain=${finished.length}`,
  );
  check(`/results/recent memuat duel Suit #${ids.suit} yang baru di-reveal`, recent.items.some((x: any) => x.id === ids.suit.toString()));

  // --- Jalur khusus ---
  const drawRow = await api(`/duels/${ids.draw}`);
  check(
    `/duels/${ids.draw} Dice seri: status ${drawRow.status}, angka ${drawRow.creatorRoll} vs ${drawRow.joinerRoll}, randomWord dari getDuel`,
    drawRow.status === "Draw" && drawRow.creatorRoll === 42 && drawRow.joinerRoll === 42 && drawRow.randomWord === ((41n << 128n) | 41n).toString(),
  );
  const invalidRow = await api(`/duels/${ids.invalid}`);
  check(
    `/duels/${ids.invalid} Suit move tidak valid: revealedMove ${invalidRow.revealedMove}, pemenang ${name(invalidRow.winner)}`,
    invalidRow.revealedMove === 4 && invalidRow.winner === bob.toLowerCase() && invalidRow.revealTimedOut === false,
  );
  const refundRow = await api(`/duels/${ids.refund}`);
  check(
    `/duels/${ids.refund} refund: status ${refundRow.status}, tanpa pemenang/fee`,
    refundRow.status === "Refunded" && refundRow.winner === null && refundRow.fee === null && refundRow.settledTx !== null,
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
      .filter(([, c]) => c.status === 4)
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

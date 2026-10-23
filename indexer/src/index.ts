import { ponder } from "ponder:registry";
import { duel, withdrawal, GAMES } from "ponder:schema";
import { encodeAbiParameters, keccak256, type Hex } from "viem";

const MASK_128 = (1n << 128n) - 1n;

/** Angka acak Coinflip/Dice, sama dengan DuelArena.reveal: keccak256(abi.encode(salt, joinerSeed)). */
function randomWordOf(salt: Hex, seed: Hex): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [salt, seed])));
}

/** Hasil turunan sesuai docs/spec.md bagian 2.1 dan 2.2. */
function deriveResults(gameName: (typeof GAMES)[number], randomWord: bigint) {
  if (gameName === "Coinflip") return { coinResult: Number(randomWord % 2n) };
  if (gameName === "Dice") {
    return {
      creatorRoll: Number((randomWord & MASK_128) % 100n) + 1,
      joinerRoll: Number((randomWord >> 128n) % 100n) + 1,
    };
  }
  return {};
}

ponder.on("DuelArena:DuelCreated", async ({ event, context }) => {
  const gameName = GAMES[event.args.game];
  if (!gameName) throw new Error(`GameType tidak dikenal: ${event.args.game}`);

  await context.db.insert(duel).values({
    id: event.args.id,
    game: gameName,
    token: event.args.token,
    amount: event.args.amount,
    creator: event.args.creator,
    creatorChoice: gameName === "Coinflip" ? event.args.creatorChoice : null,
    commit: event.args.commit,
    createdAt: event.block.timestamp,
    expiresAt: event.args.expiresAt,
    createdTx: event.transaction.hash,
    status: "Open",
  });
});

ponder.on("DuelArena:DuelJoined", async ({ event, context }) => {
  const row = await context.db.find(duel, { id: event.args.id });
  if (!row) throw new Error(`DuelJoined untuk duel ${event.args.id} yang tidak ada`);
  const isSuit = row.game === "Suit";

  await context.db.update(duel, { id: event.args.id }).set({
    joiner: event.args.joiner,
    joinerChoice: isSuit ? event.args.joinerChoice : null,
    joinerSeed: isSuit ? null : event.args.joinerSeed,
    joinedAt: event.block.timestamp,
    deadline: event.args.deadline,
    joinedTx: event.transaction.hash,
    status: "AwaitingReveal",
  });
});

ponder.on("DuelArena:Revealed", async ({ event, context }) => {
  await context.db.update(duel, { id: event.args.id }).set({
    revealedMove: event.args.move,
    revealedSalt: event.args.salt,
    revealTx: event.transaction.hash,
  });
});

ponder.on("DuelArena:DuelSettled", async ({ event, context }) => {
  const row = await context.db.find(duel, { id: event.args.id });
  if (!row) throw new Error(`DuelSettled untuk duel ${event.args.id} yang tidak ada`);
  const isSuit = row.game === "Suit";
  const timedOut = row.revealedMove === null;
  // Coinflip/Dice dengan nilai commit tidak valid (move ≠ 0) diselesaikan tanpa angka acak: randomWord = 0.
  const hasRandom = !isSuit && !timedOut && row.revealedMove === 0;

  await context.db.update(duel, { id: event.args.id }).set({
    status: "Settled",
    winner: event.args.winner,
    payout: event.args.payout,
    fee: event.args.fee,
    randomWord: hasRandom ? event.args.randomWord : null,
    ...(hasRandom ? deriveResults(row.game, event.args.randomWord) : {}),
    // Diselesaikan tanpa Revealed = claimRevealTimeout.
    revealTimedOut: timedOut,
    settledAt: event.block.timestamp,
    settledTx: event.transaction.hash,
  });
});

ponder.on("DuelArena:DuelDrawn", async ({ event, context }) => {
  const row = await context.db.find(duel, { id: event.args.id });
  if (!row) throw new Error(`DuelDrawn untuk duel ${event.args.id} yang tidak ada`);

  // DuelDrawn tidak membawa randomWord; untuk Dice hitung dari salt (event Revealed di tx yang sama) dan seed.
  let randomness = {};
  if (row.game === "Dice" && row.revealedSalt && row.joinerSeed) {
    const randomWord = randomWordOf(row.revealedSalt, row.joinerSeed);
    randomness = { randomWord, ...deriveResults("Dice", randomWord) };
  }

  await context.db.update(duel, { id: event.args.id }).set({
    status: "Draw",
    ...randomness,
    settledAt: event.block.timestamp,
    settledTx: event.transaction.hash,
  });
});

ponder.on("DuelArena:DuelCancelled", async ({ event, context }) => {
  await context.db.update(duel, { id: event.args.id }).set({
    status: "Cancelled",
    settledAt: event.block.timestamp,
    settledTx: event.transaction.hash,
  });
});

ponder.on("DuelArena:Withdrawn", async ({ event, context }) => {
  await context.db.insert(withdrawal).values({
    id: event.id,
    user: event.args.user,
    token: event.args.token,
    amount: event.args.amount,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

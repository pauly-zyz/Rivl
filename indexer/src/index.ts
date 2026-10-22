import { ponder } from "ponder:registry";
import { duel, withdrawal, GAMES } from "ponder:schema";

const MASK_128 = (1n << 128n) - 1n;
const ZERO_HASH = `0x${"0".repeat(64)}`;

/** Hasil turunan sesuai docs/spec.md bagian 2.1 dan 2.2 (sama dengan DuelArena.fulfillRandomness). */
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
    commit: event.args.commit === ZERO_HASH ? null : event.args.commit,
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
    joinedAt: event.block.timestamp,
    deadline: event.args.deadline,
    joinedTx: event.transaction.hash,
    status: isSuit ? "AwaitingReveal" : "AwaitingRandomness",
  });
});

ponder.on("DuelArena:RandomnessRequested", async ({ event, context }) => {
  await context.db.update(duel, { id: event.args.id }).set({ requestId: event.args.requestId });
});

ponder.on("DuelArena:MoveRevealed", async ({ event, context }) => {
  await context.db.update(duel, { id: event.args.id }).set({
    revealedMove: event.args.move,
    revealTx: event.transaction.hash,
  });
});

ponder.on("DuelArena:DuelSettled", async ({ event, context }) => {
  const row = await context.db.find(duel, { id: event.args.id });
  if (!row) throw new Error(`DuelSettled untuk duel ${event.args.id} yang tidak ada`);
  const isSuit = row.game === "Suit";

  await context.db.update(duel, { id: event.args.id }).set({
    status: "Settled",
    winner: event.args.winner,
    payout: event.args.payout,
    fee: event.args.fee,
    randomWord: isSuit ? null : event.args.randomWord,
    ...(isSuit ? {} : deriveResults(row.game, event.args.randomWord)),
    // Suit diselesaikan tanpa MoveRevealed = claimRevealTimeout.
    revealTimedOut: isSuit && row.revealedMove === null,
    settledAt: event.block.timestamp,
    settledTx: event.transaction.hash,
  });
});

ponder.on("DuelArena:DuelDrawn", async ({ event, context }) => {
  const row = await context.db.find(duel, { id: event.args.id });
  if (!row) throw new Error(`DuelDrawn untuk duel ${event.args.id} yang tidak ada`);

  // Event DuelDrawn tidak membawa randomWord; untuk Dice baca dari state contract di blok ini.
  let randomness = {};
  if (row.game === "Dice") {
    const d = await context.client.readContract({
      abi: context.contracts.DuelArena.abi,
      address: event.log.address,
      functionName: "getDuel",
      args: [event.args.id],
      blockNumber: event.block.number,
    });
    randomness = { randomWord: d.randomWord, ...deriveResults("Dice", d.randomWord) };
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

ponder.on("DuelArena:DuelRefunded", async ({ event, context }) => {
  await context.db.update(duel, { id: event.args.id }).set({
    status: "Refunded",
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

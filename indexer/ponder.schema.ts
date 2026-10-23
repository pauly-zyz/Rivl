import { index, onchainEnum, onchainTable } from "ponder";

/** Urutan sama dengan enum GameType di DuelArena.sol. */
export const GAMES = ["Coinflip", "Dice", "Suit"] as const;
/** Urutan sama dengan enum Status di DuelArena.sol. */
export const STATUSES = ["None", "Open", "AwaitingReveal", "Settled", "Draw", "Cancelled"] as const;

export const game = onchainEnum("game", GAMES);
export const duelStatus = onchainEnum("duel_status", STATUSES);

/**
 * Satu baris per duel (docs/spec.md bagian 4.1).
 * Semua waktu dalam detik unix (block.timestamp). Kolom null = belum terjadi / tidak berlaku untuk game itu.
 */
export const duel = onchainTable(
  "duel",
  (t) => ({
    id: t.bigint().primaryKey(),

    // DuelCreated
    game: game("game").notNull(),
    token: t.hex().notNull(), // 0x000…000 = ETH
    amount: t.bigint().notNull(), // taruhan per pemain
    creator: t.hex().notNull(),
    creatorChoice: t.integer(), // Coinflip: 0 = HEADS, 1 = TAILS. null untuk Dice/Suit.
    commit: t.hex().notNull(), // hash pilihan/rahasia pembuat (semua game)
    createdAt: t.bigint().notNull(),
    expiresAt: t.bigint().notNull(),
    createdTx: t.hex().notNull(),

    // DuelJoined
    joiner: t.hex(),
    joinerChoice: t.integer(), // Suit saja: 1 = ROCK, 2 = PAPER, 3 = SCISSORS
    joinedAt: t.bigint(),
    joinerSeed: t.hex(), // Coinflip/Dice: seed acak penerima
    deadline: t.bigint(), // batas reveal pembuat
    joinedTx: t.hex(),

    // Revealed
    revealedMove: t.integer(), // Suit: pilihan pembuat. Coinflip/Dice: 0
    revealedSalt: t.hex(),
    revealTx: t.hex(),

    // DuelSettled / DuelDrawn / DuelCancelled
    status: duelStatus("status").notNull(),
    winner: t.hex(),
    payout: t.bigint(),
    fee: t.bigint(),
    randomWord: t.bigint(), // Coinflip/Dice: keccak256(abi.encode(salt, joinerSeed))
    settledAt: t.bigint(), // waktu status akhir (termasuk batal)
    settledTx: t.hex(),

    // Turunan dari randomWord / reveal, untuk halaman detail dan /fair.
    coinResult: t.integer(), // Coinflip: randomWord % 2
    creatorRoll: t.integer(), // Dice: uint128(randomWord) % 100 + 1
    joinerRoll: t.integer(), // Dice: (randomWord >> 128) % 100 + 1
    revealTimedOut: t.boolean().notNull().default(false), // penerima menang lewat claimRevealTimeout
  }),
  (table) => ({
    statusIdx: index().on(table.status),
    creatorIdx: index().on(table.creator),
    joinerIdx: index().on(table.joiner),
    settledAtIdx: index().on(table.settledAt),
    openIdx: index().on(table.status, table.expiresAt),
  }),
);

export const withdrawal = onchainTable(
  "withdrawal",
  (t) => ({
    id: t.text().primaryKey(), // event.id
    user: t.hex().notNull(),
    token: t.hex().notNull(),
    amount: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    userIdx: index().on(table.user),
  }),
);

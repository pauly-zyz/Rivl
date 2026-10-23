import { zeroAddress, type Address, type Hex } from "viem";

export const GAMES = ["Coinflip", "Dice", "Suit"] as const;
export type Game = (typeof GAMES)[number];
export const GAME_INDEX: Record<Game, number> = { Coinflip: 0, Dice: 1, Suit: 2 };

/** Urutan sama dengan enum Status di DuelArena.sol. */
export const STATUSES = ["None", "Open", "AwaitingReveal", "Settled", "Draw", "Cancelled"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  None: "Not found",
  Open: "Open",
  AwaitingReveal: "Waiting for reveal",
  Settled: "Settled",
  Draw: "Draw",
  Cancelled: "Cancelled",
};

export const HEADS = 0;
export const TAILS = 1;
export const SIDE_NAMES = ["Heads", "Tails"] as const;

export const GAME_TAGLINE: Record<Game, string> = {
  Coinflip: "Call heads or tails. One flip decides it.",
  Dice: "Both roll 1–100. Highest number takes the pot.",
  Suit: "Rock, paper, scissors. Your move stays hidden until you reveal.",
};

/** Bentuk struct Duel dari getDuel() (viem). */
export type ChainDuel = {
  creator: Address;
  joiner: Address;
  token: Address;
  winner: Address;
  amount: bigint;
  randomWord: bigint;
  commit: Hex;
  joinerSeed: Hex;
  salt: Hex;
  createdAt: bigint;
  expiresAt: bigint;
  joinedAt: bigint;
  deadline: bigint;
  feeBpsAtCreate: number;
  game: number;
  status: number;
  creatorChoice: number;
  joinerChoice: number;
  creatorResult: number;
  joinerResult: number;
};

export const BPS = 10_000n;

/** Fee = 2 × taruhan × feeBps / 10.000; pemenang mendapat 2 × taruhan − fee (docs/spec.md 3.4). */
export function potBreakdown(stake: bigint, feeBps: number | bigint) {
  const pot = stake * 2n;
  const fee = (pot * BigInt(feeBps)) / BPS;
  return { pot, fee, payout: pot - fee };
}

/** Angka dadu dari randomWord (docs/spec.md 2.2). */
export function diceRolls(randomWord: bigint) {
  const mask = (1n << 128n) - 1n;
  return {
    creator: Number((randomWord & mask) % 100n) + 1,
    joiner: Number((randomWord >> 128n) % 100n) + 1,
  };
}

export const isZero = (a: string | null | undefined) => !a || a.toLowerCase() === zeroAddress;
export const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

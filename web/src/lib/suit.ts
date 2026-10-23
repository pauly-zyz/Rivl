import { bytesToHex, encodeAbiParameters, getAddress, isAddress, isHex, keccak256, type Address, type Hex } from "viem";

export const ROCK = 1;
export const PAPER = 2;
export const SCISSORS = 3;
export type Move = typeof ROCK | typeof PAPER | typeof SCISSORS;
export const MOVES: readonly Move[] = [ROCK, PAPER, SCISSORS];
export const MOVE_NAMES: Record<number, string> = { 1: "Rock", 2: "Paper", 3: "Scissors" };
/** Nilai `move` di commit Coinflip/Dice: rahasianya hanya salt (DuelArena.NO_MOVE). */
export const NO_MOVE = 0;
/** Nilai yang disimpan di rahasia: pilihan Suit, atau NO_MOVE untuk Coinflip/Dice. */
export type SecretMove = Move | typeof NO_MOVE;

/** Salt 32 byte acak, baru untuk setiap duel (docs/spec.md 5.3 langkah 1). */
export function randomSalt(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** Seed 32 byte acak dari penerima Coinflip/Dice, baru untuk setiap join. Tidak pernah nol. */
export function randomSeed(): Hex {
  for (;;) {
    const seed = randomSalt();
    if (BigInt(seed) !== 0n) return seed;
  }
}

/** Angka acak Coinflip/Dice = keccak256(abi.encode(bytes32 salt, bytes32 joinerSeed)) (docs/spec.md 2.1–2.2). */
export function randomWordOf(salt: Hex, seed: Hex): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [salt, seed])));
}

/**
 * commit = keccak256(abi.encode(uint256 chainId, address arena, address creator, uint8 move, bytes32 salt))
 * Dihitung di browser, tidak pernah lewat RPC (docs/spec.md 2.3 dan 5.3 langkah 2).
 */
export function computeCommit(args: {
  chainId: number | bigint;
  arena: Address;
  creator: Address;
  move: number;
  salt: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint8" }, { type: "bytes32" }],
      [BigInt(args.chainId), args.arena, args.creator, args.move, args.salt],
    ),
  );
}

/** PAPER > ROCK, SCISSORS > PAPER, ROCK > SCISSORS. Pilihan pembuat di luar 1–3 = kalah. */
export function suitWinner(creatorMove: number, joinerMove: number): "creator" | "joiner" | "draw" {
  if (creatorMove < ROCK || creatorMove > SCISSORS) return "joiner";
  if (creatorMove === joinerMove) return "draw";
  return creatorMove === (joinerMove % 3) + 1 ? "creator" : "joiner";
}

// ---------------------------------------------------------------------------
// Penyimpanan rahasia duel, semua game (docs/spec.md 5.3 langkah 3–5)
// ---------------------------------------------------------------------------

export type SuitSecret = {
  chainId: number;
  arena: Address;
  creator: Address;
  /** Suit: pilihan pembuat. Coinflip/Dice: NO_MOVE (0). */
  move: SecretMove;
  salt: Hex;
  commit: Hex;
  /** Diisi setelah transaksi create* terkonfirmasi. */
  duelId?: string;
  createdAt: number;
};

/** Penyimpanan minimal (localStorage di browser, objek biasa di test). */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export const STORAGE_KEY = "rivl:suit-secrets:v1";
const BACKUP_TYPE = "rivl-suit-secrets";

/** Validasi bentuk satu rahasia DAN bahwa commit-nya benar-benar berasal dari move + salt. */
export function parseSecret(value: unknown): SuitSecret | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const move = Number(v.move);
  if (
    !Number.isSafeInteger(v.chainId) ||
    typeof v.arena !== "string" ||
    !isAddress(v.arena) ||
    typeof v.creator !== "string" ||
    !isAddress(v.creator) ||
    !(move === NO_MOVE || MOVES.includes(move as Move)) ||
    typeof v.salt !== "string" ||
    !isHex(v.salt) ||
    v.salt.length !== 66 ||
    typeof v.commit !== "string" ||
    !isHex(v.commit) ||
    v.commit.length !== 66
  ) {
    return null;
  }
  const secret: SuitSecret = {
    chainId: v.chainId as number,
    arena: getAddress(v.arena),
    creator: getAddress(v.creator),
    move: move as SecretMove,
    salt: v.salt.toLowerCase() as Hex,
    commit: v.commit.toLowerCase() as Hex,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : 0,
    ...(typeof v.duelId === "string" && /^\d+$/.test(v.duelId) ? { duelId: v.duelId } : {}),
  };
  const expected = computeCommit(secret);
  return expected.toLowerCase() === secret.commit ? secret : null;
}

export function loadSecrets(store: KeyValueStore): SuitSecret[] {
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.map(parseSecret).filter((s): s is SuitSecret => s !== null) : [];
  } catch {
    return [];
  }
}

function writeSecrets(store: KeyValueStore, secrets: SuitSecret[]): void {
  store.setItem(STORAGE_KEY, JSON.stringify(secrets));
}

/** Gabungkan berdasarkan commit; duelId yang sudah diketahui tidak hilang. */
export function mergeSecrets(existing: SuitSecret[], incoming: SuitSecret[]): SuitSecret[] {
  const byCommit = new Map(existing.map((s) => [s.commit, s]));
  for (const s of incoming) {
    const prev = byCommit.get(s.commit);
    byCommit.set(s.commit, { ...prev, ...s, duelId: s.duelId ?? prev?.duelId });
  }
  return [...byCommit.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/** Simpan SEBELUM transaksi dikirim. Dibaca ulang untuk memastikan tersimpan. */
export function saveSecret(store: KeyValueStore, secret: SuitSecret): void {
  writeSecrets(store, mergeSecrets(loadSecrets(store), [secret]));
  if (!findSecret(store, secret.commit)) throw new Error("Could not save your duel secret in this browser.");
}

export function attachDuelId(store: KeyValueStore, commit: Hex, duelId: bigint | string): void {
  const secrets = loadSecrets(store).map((s) =>
    s.commit === commit.toLowerCase() ? { ...s, duelId: duelId.toString() } : s,
  );
  writeSecrets(store, secrets);
}

export function removeSecret(store: KeyValueStore, commit: Hex): void {
  writeSecrets(
    store,
    loadSecrets(store).filter((s) => s.commit !== commit.toLowerCase()),
  );
}

export function findSecret(store: KeyValueStore, commit: Hex): SuitSecret | undefined {
  return loadSecrets(store).find((s) => s.commit === commit.toLowerCase());
}

export function exportBackup(secrets: SuitSecret[], now = Date.now()): string {
  return JSON.stringify({ type: BACKUP_TYPE, version: 1, exportedAt: new Date(now).toISOString(), secrets }, null, 2);
}

/** Baca file backup. Entri yang rusak atau commit-nya tidak cocok dihitung sebagai invalid. */
export function parseBackup(text: string): { secrets: SuitSecret[]; invalid: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && (data as { type?: unknown }).type === BACKUP_TYPE
      ? (data as { secrets?: unknown }).secrets
      : undefined;
  if (!Array.isArray(list)) throw new Error("This file is not a Rivl backup.");
  const secrets = list.map(parseSecret).filter((s): s is SuitSecret => s !== null);
  return { secrets, invalid: list.length - secrets.length };
}

export function restoreBackup(store: KeyValueStore, text: string): { restored: number; invalid: number } {
  const { secrets, invalid } = parseBackup(text);
  writeSecrets(store, mergeSecrets(loadSecrets(store), secrets));
  return { restored: secrets.length, invalid };
}

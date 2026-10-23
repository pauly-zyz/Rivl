import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import vectors from "@rivl/contracts/test-vectors/suit-commit.json";

import {
  attachDuelId,
  computeCommit,
  exportBackup,
  findSecret,
  loadSecrets,
  parseBackup,
  parseSecret,
  randomSalt,
  randomSeed,
  randomWordOf,
  removeSecret,
  restoreBackup,
  saveSecret,
  suitWinner,
  STORAGE_KEY,
  type KeyValueStore,
  type SuitSecret,
} from "./suit";
import { diceRolls, potBreakdown } from "./duel";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const ARENA = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

function makeSecret(move: 0 | 1 | 2 | 3, salt: Hex = randomSalt()): SuitSecret {
  return {
    chainId: 31337,
    arena: ARENA,
    creator: ALICE,
    move,
    salt,
    commit: computeCommit({ chainId: 31337, arena: ARENA, creator: ALICE, move, salt }),
    createdAt: Date.now(),
  };
}

describe("Suit commit — test vector Foundry (contracts/test-vectors/suit-commit.json)", () => {
  it("memuat semua vector", () => {
    expect(vectors.vectors.length).toBe(6);
  });

  for (const v of vectors.vectors) {
    it(`${v.name}: commit sama persis dengan DuelArena.computeCommit`, () => {
      const commit = computeCommit({
        chainId: v.chainId,
        arena: v.arena as Address,
        creator: v.creator as Address,
        move: v.move,
        salt: v.salt as Hex,
      });
      expect(commit).toBe(v.commit);
    });
  }

  it("alamat lowercase/checksum menghasilkan commit yang sama", () => {
    const v = vectors.vectors[0]!;
    const commit = computeCommit({
      chainId: v.chainId,
      arena: v.arena.toLowerCase() as Address,
      creator: v.creator.toLowerCase() as Address,
      move: v.move,
      salt: v.salt as Hex,
    });
    expect(commit).toBe(v.commit);
  });
});

describe("randomSalt", () => {
  it("32 byte acak dan selalu baru", () => {
    const salts = new Set(Array.from({ length: 200 }, randomSalt));
    expect(salts.size).toBe(200);
    for (const s of salts) expect(s).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("penyimpanan rahasia Suit", () => {
  it("simpan sebelum tx, lalu tambahkan duelId setelah konfirmasi", () => {
    const store = memoryStore();
    const s = makeSecret(1);
    saveSecret(store, s);
    expect(findSecret(store, s.commit)?.duelId).toBeUndefined();

    attachDuelId(store, s.commit, 42n);
    expect(findSecret(store, s.commit)).toMatchObject({ move: 1, salt: s.salt, duelId: "42" });
  });

  it("menolak data yang commit-nya tidak cocok dengan move + salt", () => {
    const store = memoryStore();
    const tampered = { ...makeSecret(1), move: 2 };
    store.setItem(STORAGE_KEY, JSON.stringify([tampered, makeSecret(3)]));
    expect(loadSecrets(store)).toHaveLength(1);
  });

  it("localStorage rusak tidak membuat crash", () => {
    const store = memoryStore();
    store.setItem(STORAGE_KEY, "{not json");
    expect(loadSecrets(store)).toEqual([]);
  });

  it("hapus rahasia (mis. transaksi ditolak di wallet)", () => {
    const store = memoryStore();
    const s = makeSecret(2);
    saveSecret(store, s);
    removeSecret(store, s.commit);
    expect(loadSecrets(store)).toEqual([]);
  });

  it("backup lalu restore di browser lain menghasilkan data yang sama", () => {
    const a = memoryStore();
    const s1 = makeSecret(1);
    const s2 = makeSecret(3);
    saveSecret(a, s1);
    saveSecret(a, s2);
    attachDuelId(a, s1.commit, 7n);
    const file = exportBackup(loadSecrets(a));

    const b = memoryStore();
    expect(restoreBackup(b, file)).toEqual({ restored: 2, invalid: 0 });
    expect(loadSecrets(b)).toEqual(loadSecrets(a));
  });

  it("restore tidak menghapus duelId yang sudah ada dan menghitung entri rusak", () => {
    const store = memoryStore();
    const s = makeSecret(2);
    saveSecret(store, s);
    attachDuelId(store, s.commit, 9n);

    const backup = JSON.stringify({ type: "rivl-suit-secrets", version: 1, secrets: [s, { foo: 1 }] });
    expect(restoreBackup(store, backup)).toEqual({ restored: 1, invalid: 1 });
    expect(findSecret(store, s.commit)?.duelId).toBe("9");
  });

  it("file yang bukan backup Rivl ditolak", () => {
    expect(() => parseBackup("not json")).toThrow(/not valid JSON/);
    expect(() => parseBackup(JSON.stringify({ hello: "world" }))).toThrow(/not a Rivl backup/);
  });
});

describe("Coinflip/Dice: rahasia dan angka acak", () => {
  it("rahasia Coinflip/Dice (move 0) bisa disimpan, dicari, dan di-backup", () => {
    const store = memoryStore();
    const s = makeSecret(0);
    saveSecret(store, s);
    expect(findSecret(store, s.commit)?.move).toBe(0);
    const { secrets } = parseBackup(exportBackup([s]));
    expect(secrets).toHaveLength(1);
    expect(secrets[0]!.move).toBe(0);
  });

  it("menolak nilai move di luar 0–3", () => {
    const s = makeSecret(1);
    const bad = { ...s, move: 4, commit: computeCommit({ chainId: 31337, arena: ARENA, creator: ALICE, move: 4, salt: s.salt }) };
    expect(parseSecret(bad)).toBeNull();
  });

  it("randomWord = keccak256(abi.encode(salt, seed)), sama dengan cast/Solidity", () => {
    const salt = `0x${"11".repeat(32)}` as Hex;
    const seed = `0x${"22".repeat(32)}` as Hex;
    // cast keccak $(cast abi-encode "f(bytes32,bytes32)" 0x11…11 0x22…22)
    expect(randomWordOf(salt, seed)).toBe(0x3e92e0db88d6afea9edc4eedf62fffa4d92bcdfc310dccbe943747fe8302e871n);
    expect(randomWordOf(seed, salt)).not.toBe(randomWordOf(salt, seed));
  });

  it("randomSeed: 32 byte, bukan nol, selalu baru", () => {
    const a = randomSeed();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(BigInt(a)).not.toBe(0n);
    expect(randomSeed()).not.toBe(a);
  });
});

describe("aturan game", () => {
  it("suit: Paper > Rock, Scissors > Paper, Rock > Scissors, move tidak valid kalah", () => {
    expect(suitWinner(2, 1)).toBe("creator");
    expect(suitWinner(3, 2)).toBe("creator");
    expect(suitWinner(1, 3)).toBe("creator");
    expect(suitWinner(1, 2)).toBe("joiner");
    expect(suitWinner(2, 2)).toBe("draw");
    expect(suitWinner(4, 1)).toBe("joiner");
    expect(suitWinner(0, 1)).toBe("joiner");
  });

  it("fee 2,5%: 100 USDG vs 100 USDG → pemenang 195, treasury 5 (docs/spec.md 3.4)", () => {
    expect(potBreakdown(100_000_000n, 250)).toEqual({ pot: 200_000_000n, fee: 5_000_000n, payout: 195_000_000n });
  });

  it("dice: 128 bit bawah → pembuat, 128 bit atas → penerima", () => {
    expect(diceRolls((86n << 128n) | 41n)).toEqual({ creator: 42, joiner: 87 });
    expect(diceRolls(2n ** 256n - 1n)).toEqual({ creator: 56, joiner: 56 });
  });
});

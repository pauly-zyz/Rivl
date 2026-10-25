/**
 * Katalog kosmetik hadiah Daily Spin. Tampilan visualnya ada di web (web/src/lib/cosmetics.ts, kunci = id).
 * weight = bobot relatif saat hadiah "cosmetic" keluar (makin kecil makin langka).
 */
export type CosmeticKind = "frame" | "badge" | "title";
export type Rarity = "common" | "rare" | "epic" | "legendary";
export type Cosmetic = { id: string; kind: CosmeticKind; name: string; rarity: Rarity; spin: boolean };

const W: Record<Rarity, number> = { common: 50, rare: 25, epic: 12, legendary: 5 };

export const COSMETICS: Cosmetic[] = [
  { id: "frame-ember", kind: "frame", name: "Ember", rarity: "common", spin: true },
  { id: "frame-frost", kind: "frame", name: "Frost", rarity: "common", spin: true },
  { id: "frame-neon", kind: "frame", name: "Neon", rarity: "rare", spin: true },
  { id: "frame-gold", kind: "frame", name: "Gold", rarity: "epic", spin: true },
  { id: "frame-holo", kind: "frame", name: "Holo", rarity: "legendary", spin: true },
  { id: "badge-clover", kind: "badge", name: "Lucky Clover", rarity: "common", spin: true },
  { id: "badge-flame", kind: "badge", name: "On Fire", rarity: "common", spin: true },
  { id: "badge-dice", kind: "badge", name: "Dice Lord", rarity: "rare", spin: true },
  { id: "badge-crown", kind: "badge", name: "Crown", rarity: "epic", spin: true },
  { id: "badge-diamond", kind: "badge", name: "Diamond Hands", rarity: "legendary", spin: true },
  { id: "badge-jackpot", kind: "badge", name: "Jackpot Winner", rarity: "legendary", spin: false },
  { id: "title-unflippable", kind: "title", name: "The Unflippable", rarity: "common", spin: true },
  { id: "title-rock-solid", kind: "title", name: "Rock Solid", rarity: "common", spin: true },
  { id: "title-paper-tiger", kind: "title", name: "Paper Tiger", rarity: "common", spin: true },
  { id: "title-high-roller", kind: "title", name: "High Roller", rarity: "rare", spin: true },
  { id: "title-arena-legend", kind: "title", name: "Arena Legend", rarity: "legendary", spin: true },
];

export const cosmeticById = new Map(COSMETICS.map((c) => [c.id, c]));

/** Pilih kosmetik yang belum dimiliki, berbobot kelangkaan. `r` = angka acak 0..2^256. undefined = sudah punya semua. */
export function pickCosmetic(owned: Set<string>, r: bigint): Cosmetic | undefined {
  const pool = COSMETICS.filter((c) => c.spin && !owned.has(c.id));
  const total = pool.reduce((n, c) => n + W[c.rarity], 0);
  if (total === 0) return undefined;
  let x = Number(r % BigInt(total));
  for (const c of pool) {
    x -= W[c.rarity];
    if (x < 0) return c;
  }
  return pool[pool.length - 1];
}

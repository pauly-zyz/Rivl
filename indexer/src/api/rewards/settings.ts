/** Pengaturan Daily Spin yang bisa diubah owner dari panel /me (disimpan di database, tanpa deploy ulang). */
import { rewardsEnv } from "./env";
import { store } from "./store";

/** Hadiah yang bisa keluar dari roda. */
export const PRIZES = [
  "try_again",
  "fee_free_1",
  "fee_free_3",
  "xp_50",
  "xp_150",
  "cosmetic",
  "rivl_10k",
  "rivl_50k",
  "jackpot",
] as const;
export type Prize = (typeof PRIZES)[number];

/** Peluang dalam ppm (1.000.000 = 100%). Jackpot diatur terpisah (jackpotPpm) dan diambil dari xp_150 (atau slice terbesar). */
export type Odds = Record<Exclude<Prize, "jackpot">, number>;

export type Settings = {
  /** Spin aktif. Default mati sampai owner menyalakannya saat token RIVL launch. */
  enabled: boolean;
  /** Waktu launch (detik unix). Jackpot 0% sampai launchAt + jackpotDelayDays. */
  launchAt: number | null;
  jackpotDelayDays: number;
  jackpotPpm: number;
  jackpotWeeklyMax: number;
  /** Minimal RIVL (token utuh) yang harus dipegang tanpa turun selama minHoldHours. */
  minHoldTokens: string;
  minHoldHours: number;
  /** Batas total hadiah RIVL per minggu (token utuh), termasuk jackpot. */
  weeklyRivlBudget: string;
  /** Setelah N kali "coba lagi" berturut-turut, spin berikutnya dijamin dapat hadiah. */
  pityAfter: number;
  odds: Odds;
};

export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  launchAt: null,
  jackpotDelayDays: 7,
  jackpotPpm: 500,
  jackpotWeeklyMax: 1,
  minHoldTokens: "2000000",
  minHoldHours: 12,
  weeklyRivlBudget: "5000000",
  pityAfter: 7,
  odds: {
    try_again: 400_000,
    fee_free_1: 180_000,
    fee_free_3: 40_000,
    xp_50: 200_000,
    xp_150: 70_000,
    cosmetic: 100_000,
    rivl_10k: 8_000,
    rivl_50k: 2_000,
  },
};

const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isWhole = (v: unknown) => typeof v === "string" && /^\d{1,30}$/.test(v);

/** Validasi ketat; melempar Error dengan pesan yang bisa ditampilkan ke owner. */
export function validateSettings(input: unknown): Settings {
  const s = input as Settings;
  const fail = (m: string) => {
    throw new Error(m);
  };
  if (typeof s !== "object" || s === null) fail("settings must be an object");
  if (typeof s.enabled !== "boolean") fail("enabled must be true/false");
  if (s.launchAt !== null && !isInt(s.launchAt, 0)) fail("launchAt must be a unix time or null");
  if (!isInt(s.jackpotDelayDays, 0, 365)) fail("jackpotDelayDays must be 0–365");
  if (!isInt(s.jackpotPpm, 0, 1_000_000)) fail("jackpotPpm must be 0–1,000,000");
  if (!isInt(s.jackpotWeeklyMax, 0, 100)) fail("jackpotWeeklyMax must be 0–100");
  if (!isWhole(s.minHoldTokens)) fail("minHoldTokens must be a whole number");
  if (!isInt(s.minHoldHours, 0, 24 * 30)) fail("minHoldHours must be 0–720");
  if (!isWhole(s.weeklyRivlBudget)) fail("weeklyRivlBudget must be a whole number");
  if (!isInt(s.pityAfter, 0, 365)) fail("pityAfter must be 0–365");
  const keys = Object.keys(DEFAULT_SETTINGS.odds) as (keyof Odds)[];
  if (typeof s.odds !== "object" || s.odds === null) fail("odds missing");
  for (const k of keys) if (!isInt(s.odds[k], 0, 1_000_000)) fail(`odds.${k} must be 0–1,000,000 ppm`);
  const sum = keys.reduce((n, k) => n + s.odds[k], 0);
  if (sum !== 1_000_000) fail(`odds must add up to 100% (now ${(sum / 10_000).toFixed(2)}%)`);
  return {
    enabled: s.enabled,
    launchAt: s.launchAt,
    jackpotDelayDays: s.jackpotDelayDays,
    jackpotPpm: s.jackpotPpm,
    jackpotWeeklyMax: s.jackpotWeeklyMax,
    minHoldTokens: s.minHoldTokens,
    minHoldHours: s.minHoldHours,
    weeklyRivlBudget: s.weeklyRivlBudget,
    pityAfter: s.pityAfter,
    odds: Object.fromEntries(keys.map((k) => [k, s.odds[k]])) as Odds,
  };
}

/** Chain lokal: spin langsung aktif tanpa masa hold, supaya bisa dicoba setelah `pnpm dev`. */
const initial = (): Settings =>
  rewardsEnv.mode === "local" ? { ...DEFAULT_SETTINGS, enabled: true, minHoldHours: 0 } : DEFAULT_SETTINGS;

export async function getSettings(): Promise<Settings> {
  const db = await store();
  const [row] = await db.query<{ data: string }>("select data from rivl_rewards.settings where id = 1");
  if (!row) return initial();
  try {
    return validateSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(row.data) });
  } catch {
    return initial();
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  const db = await store();
  await db.query(
    `insert into rivl_rewards.settings (id, data, updated_at) values (1, $1, $2)
     on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at`,
    [JSON.stringify(s), Math.floor(Date.now() / 1000)],
  );
}

/** Tabel peluang yang berlaku pada waktu `now` (jackpot aktif setelah masa awal). */
export function effectiveOdds(s: Settings, now: number): Record<Prize, number> {
  const jackpotOn = s.launchAt !== null && now >= s.launchAt + s.jackpotDelayDays * 86_400 && s.jackpotWeeklyMax > 0;
  const jackpot = jackpotOn ? s.jackpotPpm : 0;
  // Jackpot diambil dari +150 XP; jika slice itu terlalu kecil, dari slice terbesar.
  const odds: Record<Prize, number> = { ...s.odds, jackpot };
  const from: Exclude<Prize, "jackpot"> =
    s.odds.xp_150 >= jackpot
      ? "xp_150"
      : (Object.entries(s.odds).sort((a, b) => b[1] - a[1])[0]![0] as Exclude<Prize, "jackpot">);
  odds[from] -= Math.min(jackpot, odds[from]);
  odds.jackpot = Math.min(jackpot, s.odds[from]);
  return odds;
}

import { describe, expect, it } from "vitest";

import { countryFromHeaders, isBlocked, parseBlockedCountries } from "./geo";
import {
  DAY,
  effectiveLimit,
  EMPTY_LIMITS,
  loadLimits,
  onBreak,
  pendingLimit,
  saveLimits,
  setDailyLimit,
  spentInLastDay,
  startBreak,
  type StakeRecord,
} from "./limits";
import type { KeyValueStore } from "./suit";

describe("geoblock", () => {
  it("default: tidak ada negara yang diblokir", () => {
    expect([...parseBlockedCountries(undefined)]).toEqual([]);
    expect([...parseBlockedCountries("  ")]).toEqual([]);
    for (const c of ["ID", "US", "DE"]) expect(isBlocked(c, parseBlockedCountries(undefined))).toBe(false);
  });

  it("parse daftar dari env, abaikan entri tidak valid", () => {
    expect([...parseBlockedCountries("gb, fr ,X,usa,DE")]).toEqual(["GB", "FR", "DE"]);
  });

  it("membaca header negara dari hosting/CDN", () => {
    expect(countryFromHeaders(new Headers({ "x-vercel-ip-country": "id" }))).toBe("ID");
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "US" }))).toBe("US");
    expect(countryFromHeaders(new Headers({ "cloudfront-viewer-country": "DE" }))).toBe("DE");
    expect(countryFromHeaders(new Headers())).toBeUndefined();
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "XX" }))).toBeUndefined();
  });

  it("GEO_COUNTRY_HEADER membuat hanya header itu yang dipercaya", () => {
    const h = new Headers({ "cf-ipcountry": "US", "x-my-cdn-country": "DE" });
    expect(countryFromHeaders(h, "x-my-cdn-country")).toBe("DE");
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "US" }), "x-my-cdn-country")).toBeUndefined();
  });

  it("negara tidak diketahui tidak diblokir", () => {
    const blocked = parseBlockedCountries("ID,US");
    expect(isBlocked("ID", blocked)).toBe(true);
    expect(isBlocked("DE", blocked)).toBe(false);
    expect(isBlocked(undefined, blocked)).toBe(false);
  });
});

describe("batas taruhan harian", () => {
  const ETH = "0x0000000000000000000000000000000000000000";
  const now = 1_800_000_000;

  it("memasang batas pertama berlaku langsung", () => {
    const s = setDailyLimit(EMPTY_LIMITS, ETH, 100n, now);
    expect(effectiveLimit(s, ETH, now)).toBe(100n);
  });

  it("menurunkan batas berlaku langsung", () => {
    let s = setDailyLimit(EMPTY_LIMITS, ETH, 100n, now);
    s = setDailyLimit(s, ETH, 40n, now + 10);
    expect(effectiveLimit(s, ETH, now + 10)).toBe(40n);
    expect(pendingLimit(s, ETH, now + 10)).toBeUndefined();
  });

  it("menaikkan batas baru berlaku setelah 24 jam", () => {
    let s = setDailyLimit(EMPTY_LIMITS, ETH, 100n, now);
    s = setDailyLimit(s, ETH, 500n, now);
    expect(effectiveLimit(s, ETH, now + DAY - 1)).toBe(100n);
    expect(pendingLimit(s, ETH, now)).toEqual({ amount: 500n, effectiveAt: now + DAY });
    expect(effectiveLimit(s, ETH, now + DAY)).toBe(500n);
  });

  it("menghapus batas baru berlaku setelah 24 jam", () => {
    let s = setDailyLimit(EMPTY_LIMITS, ETH, 100n, now);
    s = setDailyLimit(s, ETH, null, now);
    expect(effectiveLimit(s, ETH, now + 60)).toBe(100n);
    expect(effectiveLimit(s, ETH, now + DAY)).toBeNull();
  });

  it("alamat token tidak peka huruf besar/kecil", () => {
    const usdg = "0xE7f1725E7734CE288F8367e1Bb143E90bb3F0512";
    const s = setDailyLimit(EMPTY_LIMITS, usdg, 5n, now);
    expect(effectiveLimit(s, usdg.toLowerCase(), now)).toBe(5n);
  });

  it("taruhan 24 jam terakhir: sebagai pembuat atau penantang, tanpa duel yang dibatalkan", () => {
    const me = "0xAAAA000000000000000000000000000000000001";
    const other = "0xbbbb000000000000000000000000000000000002";
    const duel = (o: Partial<StakeRecord>): StakeRecord => ({
      token: ETH,
      amount: "10",
      creator: me,
      joiner: null,
      createdAt: String(now - 60),
      joinedAt: null,
      status: "Open",
      ...o,
    });
    const duels = [
      duel({}), // 10: dibuat 1 menit lalu
      duel({ amount: "20", creator: other, joiner: me.toLowerCase(), createdAt: String(now - 2 * DAY), joinedAt: String(now - 100), status: "Settled" }), // 20: bergabung barusan
      duel({ amount: "40", createdAt: String(now - DAY - 1) }), // terlalu lama
      duel({ amount: "80", status: "Cancelled" }), // dibatalkan
      duel({ amount: "160", token: "0x1111111111111111111111111111111111111111" }), // token lain
    ];
    expect(spentInLastDay(duels, me, ETH, now)).toBe(30n);
  });
});

describe("take a break", () => {
  const now = 1_800_000_000;

  it("aktif sampai waktunya habis", () => {
    const s = startBreak(EMPTY_LIMITS, DAY, now);
    expect(onBreak(s, now + DAY - 1)).toBe(true);
    expect(onBreak(s, now + DAY)).toBe(false);
  });

  it("hanya bisa diperpanjang, tidak dipersingkat", () => {
    let s = startBreak(EMPTY_LIMITS, 7 * DAY, now);
    s = startBreak(s, DAY, now);
    expect(s.breakUntil).toBe(now + 7 * DAY);
  });

  it("tersimpan dan dimuat ulang; data rusak diabaikan", () => {
    const data = new Map<string, string>();
    const store: KeyValueStore = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    saveLimits(store, startBreak(EMPTY_LIMITS, DAY, now));
    expect(onBreak(loadLimits(store), now + 1)).toBe(true);
    data.set("rivl:limits:v1", "{broken");
    expect(loadLimits(store)).toEqual(EMPTY_LIMITS);
  });
});

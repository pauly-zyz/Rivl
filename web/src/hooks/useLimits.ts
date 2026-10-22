"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Address } from "viem";

import { usePlayerDuels } from "@/lib/indexer";
import {
  effectiveLimit,
  EMPTY_LIMITS,
  LIMITS_KEY,
  loadLimits,
  onBreak,
  pendingLimit,
  saveLimits,
  setDailyLimit,
  spentInLastDay,
  startBreak,
  type LimitsState,
} from "@/lib/limits";
import { browserStore } from "@/lib/storage";

const nowSec = () => Math.floor(Date.now() / 1000);

// Satu store bersama untuk semua komponen di tab ini; tab lain tersinkron lewat event "storage".
const listeners = new Set<() => void>();
let cache: LimitsState | undefined;

function readLimits(): LimitsState {
  if (!cache) {
    const store = browserStore();
    cache = store ? loadLimits(store) : EMPTY_LIMITS;
  }
  return cache;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== LIMITS_KEY) return;
    cache = undefined;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function writeLimits(fn: (s: LimitsState, now: number) => LimitsState) {
  const store = browserStore();
  if (!store) throw new Error("This browser blocks local storage, so limits can't be saved.");
  const next = fn(loadLimits(store), nowSec());
  saveLimits(store, next);
  cache = next;
  listeners.forEach((l) => l());
}

/** Batas pribadi di localStorage. Waktu memakai jam perangkat. */
export function useLimits() {
  // Server dan render pertama memakai EMPTY_LIMITS, lalu nilai dari localStorage (tanpa hydration mismatch).
  const state = useSyncExternalStore(subscribe, readLimits, () => EMPTY_LIMITS);
  const [now, setNow] = useState(nowSec);

  useEffect(() => {
    const t = setInterval(() => setNow(nowSec()), 30_000);
    return () => clearInterval(t);
  }, []);

  return {
    now,
    state,
    onBreak: onBreak(state, now),
    breakUntil: state.breakUntil,
    limitFor: (token: string) => effectiveLimit(state, token, now),
    pendingFor: (token: string) => pendingLimit(state, token, now),
    setLimit: (token: string, amount: bigint | null) => writeLimits((s, n) => setDailyLimit(s, token, amount, n)),
    takeBreak: (seconds: number) => writeLimits((s, n) => startBreak(s, seconds, n)),
  };
}

/** Sisa batas harian untuk satu token. `exceeds` = taruhan `amount` melewati batas. */
export function useDailyAllowance(address: Address | undefined, token: string | undefined, amount: bigint | undefined) {
  const limits = useLimits();
  const { data } = usePlayerDuels(address);
  const limit = token ? limits.limitFor(token) : null;
  const spent = address && token && data ? spentInLastDay(data, address, token, limits.now) : 0n;
  const remaining = limit === null ? null : limit > spent ? limit - spent : 0n;
  return {
    limit,
    spent,
    remaining,
    exceeds: remaining !== null && amount !== undefined && amount > remaining,
    onBreak: limits.onBreak,
    breakUntil: limits.breakUntil,
  };
}

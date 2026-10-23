"use client";

import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";

import {
  attachDuelId,
  exportBackup,
  findSecret,
  loadSecrets,
  removeSecret,
  restoreBackup,
  saveSecret,
  STORAGE_KEY,
  type KeyValueStore,
  type SuitSecret,
} from "@/lib/suit";
import { browserStore } from "@/lib/storage";

/** Event di tab yang sama setelah rahasia berubah (event "storage" hanya terkirim ke tab lain). */
const LOCAL_EVENT = "rivl:secrets-changed";

/** Rahasia duel (semua game) di localStorage, tersinkron antar komponen dan antar tab. */
export function useSuitSecrets() {
  const [secrets, setSecrets] = useState<SuitSecret[]>([]);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(() => {
    const store = browserStore();
    setAvailable(!!store);
    setSecrets(store ? loadSecrets(store) : []);
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(LOCAL_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(LOCAL_EVENT, refresh);
    };
  }, [refresh]);

  const withStore = useCallback(
    <T,>(fn: (s: KeyValueStore) => T): T => {
      const store = browserStore();
      if (!store) {
        throw new Error("This browser blocks local storage, so your duel secret can't be saved. Use a normal window.");
      }
      const result = fn(store);
      // Semua pemakai hook ini di tab yang sama (mis. banner reveal) ikut melihat perubahan.
      window.dispatchEvent(new Event(LOCAL_EVENT));
      return result;
    },
    [refresh],
  );

  return {
    secrets,
    available,
    save: useCallback((s: SuitSecret) => withStore((st) => saveSecret(st, s)), [withStore]),
    attach: useCallback((commit: Hex, duelId: bigint) => withStore((st) => attachDuelId(st, commit, duelId)), [withStore]),
    remove: useCallback((commit: Hex) => withStore((st) => removeSecret(st, commit)), [withStore]),
    find: useCallback(
      (commit: Hex | null | undefined) => (commit ? secrets.find((s) => s.commit === commit.toLowerCase()) : undefined),
      [secrets],
    ),
    findNow: useCallback((commit: Hex) => withStore((st) => findSecret(st, commit)), [withStore]),
    backup: useCallback(() => exportBackup(secrets), [secrets]),
    restore: useCallback((text: string) => withStore((st) => restoreBackup(st, text)), [withStore]),
  };
}

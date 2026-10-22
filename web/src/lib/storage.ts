import type { KeyValueStore } from "./suit";

/** localStorage jika tersedia (bisa diblokir di mode privat / pengaturan browser). */
export function browserStore(): KeyValueStore | null {
  try {
    const s = window.localStorage;
    const probe = "rivl:probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

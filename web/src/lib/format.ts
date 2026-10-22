import { formatUnits, getAddress, isAddress, parseUnits } from "viem";

/** "0x7099…79C8". Alamat ditampilkan dalam format checksum (indexer mengirim huruf kecil). */
export function shortAddress(a: string | null | undefined): string {
  if (!a) return "—";
  const s = isAddress(a) ? getAddress(a) : a;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

/** Format jumlah token, maksimal `maxDecimals` angka di belakang koma, tanpa nol berlebih. */
export function formatAmount(amount: bigint | string, decimals: number, maxDecimals = 6): string {
  const s = formatUnits(BigInt(amount), decimals);
  const [int, frac = ""] = s.split(".");
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, "");
  const intFmt = BigInt(int!).toLocaleString("en-US");
  return trimmed ? `${intFmt}.${trimmed}` : intFmt;
}

/** Parse input pengguna. Mengembalikan undefined jika tidak valid. */
export function parseAmount(value: string, decimals: number): bigint | undefined {
  const v = value.trim();
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return undefined;
  const [, frac = ""] = v.split(".");
  if (frac.length > decimals) return undefined;
  try {
    return parseUnits(v, decimals);
  } catch {
    return undefined;
  }
}

/** "2h 05m", "4m 12s", "38s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

export function timeAgo(seconds: number): string {
  if (seconds < 60) return "just now";
  return `${formatDuration(seconds).split(" ")[0]} ago`;
}

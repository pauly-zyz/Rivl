/**
 * Geoblock (docs/spec.md 5.4). Negara dibaca dari header yang dipasang hosting/CDN.
 *
 * Header pengguna bisa dipalsukan jika aplikasi TIDAK berada di belakang CDN yang menimpanya.
 * Di produksi, set GEO_COUNTRY_HEADER ke header milik hosting yang dipakai supaya hanya header itu dipercaya.
 */

/** Header negara yang umum: Vercel, Cloudflare, AWS CloudFront, Google App Engine. */
export const DEFAULT_COUNTRY_HEADERS = [
  "x-vercel-ip-country",
  "cf-ipcountry",
  "cloudfront-viewer-country",
  "x-appengine-country",
] as const;

/** "id, us" → {"ID","US"}. Kosong/tidak di-set → tidak ada negara yang diblokir (default spec 5.4). */
export function parseBlockedCountries(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c)),
  );
}

/** Kode negara ISO 3166-1 alpha-2 dari header, atau undefined jika tidak ada / tidak dikenal (mis. "XX", "T1"). */
export function countryFromHeaders(headers: Headers, customHeader?: string): string | undefined {
  const names = customHeader?.trim() ? [customHeader.trim().toLowerCase()] : DEFAULT_COUNTRY_HEADERS;
  for (const name of names) {
    const v = headers.get(name)?.trim().toUpperCase();
    if (v && /^[A-Z]{2}$/.test(v) && v !== "XX") return v;
  }
  return undefined;
}

export function isBlocked(country: string | undefined, blocked: Set<string>): boolean {
  return !!country && blocked.has(country);
}

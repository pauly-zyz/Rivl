import { NextResponse, type NextRequest } from "next/server";

import { countryFromHeaders, isBlocked, parseBlockedCountries } from "@/lib/geo";

/**
 * Geoblock (docs/spec.md 5.4). Next.js 16 menamai middleware sebagai "proxy" (fungsinya sama).
 * Default semua negara boleh akses. Pengunjung dari negara di BLOCKED_COUNTRIES (jika diisi) hanya melihat "Not available in your region".
 * Env dibaca saat request, jadi daftar negara bisa diubah tanpa build ulang.
 */
export function proxy(request: NextRequest) {
  const country = countryFromHeaders(request.headers, process.env.GEO_COUNTRY_HEADER);
  if (!isBlocked(country, parseBlockedCountries(process.env.BLOCKED_COUNTRIES))) return NextResponse.next();

  if (request.nextUrl.pathname === "/blocked") return NextResponse.next();
  // 451 Unavailable For Legal Reasons.
  return NextResponse.rewrite(new URL("/blocked", request.url), { status: 451 });
}

export const config = {
  // Semua halaman, kecuali aset statis yang dibutuhkan halaman blokir itu sendiri.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "../globals.css";

/** Root layout terpisah: pengunjung yang diblokir tidak memuat wallet, header, atau age gate. */
export const metadata: Metadata = {
  title: "Rivl — Not available in your region",
  robots: { index: false },
};

export const viewport: Viewport = { themeColor: "#0a0b0d", width: "device-width", initialScale: 1 };

export default function BlockedLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

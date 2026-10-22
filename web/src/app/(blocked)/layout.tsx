import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "../globals.css";
import { fontVariables } from "../fonts";

/** Root layout terpisah: pengunjung yang diblokir tidak memuat wallet, header, atau age gate. */
export const metadata: Metadata = {
  title: "Rivl — Not available in your region",
  robots: { index: false },
};

export const viewport: Viewport = { themeColor: "#08090b", width: "device-width", initialScale: 1 };

export default function BlockedLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="min-h-dvh">
        <div aria-hidden className="arena-backdrop" />
        {children}
      </body>
    </html>
  );
}

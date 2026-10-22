import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { RevealBanner } from "@/components/RevealBanner";
import { configResult } from "@/lib/config";

export const metadata: Metadata = {
  title: "Rivl — Find your rival. Take the pot.",
  description: "1v1 duels on Robinhood Chain. Coinflip, Dice Duel and Suit with provably fair results.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Providers>
          {configResult.ok && (
            <>
              <Header />
              <RevealBanner />
            </>
          )}
          <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}

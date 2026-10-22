"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Lobby" },
  { href: "/me", label: "My duels" },
];

export function Logo() {
  return (
    <span className="text-2xl font-black tracking-tight">
      Rivl<span className="text-red">.</span>
    </span>
  );
}

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Rivl home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 text-sm font-semibold">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-md px-2.5 py-1.5 ${path === n.href ? "text-ink" : "text-muted hover:text-ink"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <ConnectButton
            label="Connect"
            showBalance={false}
            chainStatus={{ smallScreen: "none", largeScreen: "icon" }}
            accountStatus={{ smallScreen: "avatar", largeScreen: "address" }}
          />
        </div>
      </div>
    </header>
  );
}

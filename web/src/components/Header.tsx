"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Lobby", mobile: true },
  { href: "/me", label: "My duels", mobile: true },
  { href: "/fair", label: "Fair", mobile: false },
  { href: "/rules", label: "Rules", mobile: false },
];

/** Logo teks sederhana (docs/spec.md 5.5): "Rivl" expanded hitam, titik merah. */
export function Logo({ className = "text-2xl" }: { className?: string }) {
  return (
    <span className={`font-display font-black leading-none ${className}`}>
      Rivl<span className="text-red">.</span>
    </span>
  );
}

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/75 backdrop-blur-xl">
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-red/60 via-transparent to-blue/60" />
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" aria-label="Rivl home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-0.5 text-sm font-semibold">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`relative rounded-lg px-2.5 py-1.5 transition-colors ${n.mobile ? "" : "hidden md:inline"} ${
                path === n.href ? "bg-raised text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {n.label}
              {path === n.href && <span aria-hidden className="absolute inset-x-2.5 -bottom-[13px] h-0.5 rounded-full bg-red" />}
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

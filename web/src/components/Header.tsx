"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { setMuted, unlockAudioOnInteraction, useSoundMuted } from "@/lib/sfx";

const NAV = [
  { href: "/", label: "Lobby", mobile: true },
  { href: "/me", label: "My duels", mobile: true },
  { href: "/spin", label: "Spin", mobile: true },
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

/** Tombol suara efek arena (MATCH FOUND, hitung mundur, menang/kalah). */
function SoundToggle() {
  const muted = useSoundMuted();
  useEffect(unlockAudioOnInteraction, []);
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
      aria-pressed={!muted}
      title={muted ? "Sound off" : "Sound on"}
      data-testid="sound-toggle"
      className="grid h-10 w-9 place-items-center rounded-xl border border-line text-muted sm:w-10 transition-colors hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 10v4h4l5 4V6L8 10z" fill="currentColor" fillOpacity="0.15" />
        {muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" />}
      </svg>
    </button>
  );
}

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/75 backdrop-blur-xl">
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-red/60 via-transparent to-blue/60" />
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-6 sm:px-6">
        <Link href="/" aria-label="Rivl home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-0.5 text-sm font-semibold">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`relative rounded-lg px-2 py-1.5 transition-colors sm:px-2.5 ${n.mobile ? "" : "hidden md:inline"} ${
                path === n.href ? "bg-raised text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {n.label}
              {path === n.href && <span aria-hidden className="absolute inset-x-2 -bottom-[13px] sm:inset-x-2.5 h-0.5 rounded-full bg-red" />}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <SoundToggle />
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

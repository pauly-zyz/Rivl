/**
 * Tampilan kosmetik hadiah Daily Spin (id sama dengan indexer/src/api/rewards/cosmetics.ts).
 * Frame = cincin di sekeliling avatar, badge = ikon kecil di pojok avatar, title = teks di bawah nama.
 */
import type { CSSProperties } from "react";

import type { Rarity } from "./rewards";

export const RARITY_STYLE: Record<Rarity, { label: string; text: string; border: string }> = {
  common: { label: "Common", text: "text-steel", border: "border-line-strong" },
  rare: { label: "Rare", text: "text-[#5ad1ff]", border: "border-[#5ad1ff]/50" },
  epic: { label: "Epic", text: "text-[#c58bff]", border: "border-[#c58bff]/50" },
  legendary: { label: "Legendary", text: "text-[#ffc94d]", border: "border-[#ffc94d]/60" },
};

/** Gradien cincin frame; `spin: true` = berputar pelan. */
export const FRAMES: Record<string, { gradient: string; glow: string; spin?: boolean }> = {
  "frame-ember": { gradient: "conic-gradient(#ff3d2e, #ff9a3c, #ff3d2e, #b3121b, #ff3d2e)", glow: "rgb(255 90 50 / 0.55)" },
  "frame-frost": { gradient: "conic-gradient(#bfe9ff, #5aa9ff, #e8f6ff, #3b7bff, #bfe9ff)", glow: "rgb(110 180 255 / 0.5)" },
  "frame-neon": { gradient: "conic-gradient(#00ffd5, #ff00e5, #00ffd5, #7a5cff, #00ffd5)", glow: "rgb(0 255 213 / 0.5)", spin: true },
  "frame-gold": { gradient: "conic-gradient(#fff3b0, #e0a526, #fff7d1, #b27a10, #fff3b0)", glow: "rgb(255 200 70 / 0.6)" },
  "frame-holo": {
    gradient: "conic-gradient(#ff5e5e, #ffd25e, #5eff8b, #5ed7ff, #8b5eff, #ff5ee1, #ff5e5e)",
    glow: "rgb(255 255 255 / 0.45)",
    spin: true,
  },
};

export const BADGES: Record<string, { icon: string; bg: string }> = {
  "badge-clover": { icon: "🍀", bg: "#12301c" },
  "badge-flame": { icon: "🔥", bg: "#3a1408" },
  "badge-dice": { icon: "🎲", bg: "#1d1f3a" },
  "badge-crown": { icon: "👑", bg: "#3a2c08" },
  "badge-diamond": { icon: "💎", bg: "#0b2a3a" },
  "badge-jackpot": { icon: "🎰", bg: "#3a0b2c" },
};

/** Warna title mengikuti kelangkaan; legendary memakai gradien. */
export function titleStyle(rarity: Rarity | undefined): { className: string; style?: CSSProperties } {
  if (rarity === "legendary") {
    return {
      className: "bg-clip-text text-transparent",
      style: { backgroundImage: "linear-gradient(90deg, #ffc94d, #ff7a59, #c58bff)" },
    };
  }
  return { className: rarity ? RARITY_STYLE[rarity].text : "text-muted" };
}

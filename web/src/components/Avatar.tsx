"use client";

import { useMemo } from "react";
import { hexToBytes, keccak256, type Hex } from "viem";

import { BADGES, FRAMES, titleStyle } from "@/lib/cosmetics";
import { useEquipped, useRewardsInfo } from "@/lib/rewards";

type Corner = "red" | "blue" | "neutral";

const TONES: Record<Corner, { fg: string; bg: string; ring: string }> = {
  red: { fg: "#ff6369", bg: "#2c1214", ring: "ring-red/60" },
  blue: { fg: "#7096ff", bg: "#111b33", ring: "ring-blue/60" },
  neutral: { fg: "#c9ced8", bg: "#171a20", ring: "ring-line-strong" },
};

/**
 * Identicon 5×5 simetris dari hash alamat. Bentuk unik per alamat, warna mengikuti sudut arena.
 * Tanpa alamat (slot penantang kosong): tanda tanya di atas pola diagonal.
 * Kosmetik Daily Spin yang dipakai pemain (frame & badge) ikut tampil, kecuali `plain`.
 */
export function Avatar({
  address,
  corner = "neutral",
  size = 40,
  className = "",
  plain = false,
  frame: frameOverride,
  badge: badgeOverride,
}: {
  address?: string | null;
  corner?: Corner;
  size?: number;
  className?: string;
  plain?: boolean;
  /** Pratinjau kosmetik tertentu (inventaris), menggantikan yang dipakai. */
  frame?: string | null;
  badge?: string | null;
}) {
  const tone = TONES[corner];
  const equipped = useEquipped(plain ? undefined : address);
  const frame = FRAMES[(frameOverride !== undefined ? frameOverride : equipped.frame) ?? ""];
  const badge = BADGES[(badgeOverride !== undefined ? badgeOverride : equipped.badge) ?? ""];
  const cells = useMemo(() => {
    if (!address) return [];
    const bytes = hexToBytes(keccak256(address.toLowerCase() as Hex));
    const out: [number, number][] = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (bytes[row * 3 + col]! % 2 === 0) {
          out.push([col, row]);
          if (col < 2) out.push([4 - col, row]);
        }
      }
    }
    return out;
  }, [address]);

  const face = (
    <span
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-xl ${frame ? "" : `ring-2 ${tone.ring}`} ${
        address ? "" : "hatch"
      } ${frame ? "" : className}`}
      style={{ width: size, height: size, background: tone.bg }}
      aria-hidden
    >
      {address ? (
        <svg viewBox="-1 -1 7 7" width={size * 0.72} height={size * 0.72} shapeRendering="crispEdges">
          {cells.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={tone.fg} />
          ))}
        </svg>
      ) : (
        <span className="font-display font-black" style={{ color: tone.fg, fontSize: size * 0.42 }}>
          ?
        </span>
      )}
    </span>
  );

  if (!frame && !badge) return face;

  const pad = Math.max(2, Math.round(size / 18));
  const badgeSize = Math.max(14, Math.round(size * 0.36));
  return (
    <span className={`relative inline-grid shrink-0 place-items-center rounded-xl ${frame ? className : ""}`} aria-hidden>
      {frame ? (
        <span
          className="relative grid place-items-center overflow-hidden rounded-[inherit]"
          style={{ padding: pad, boxShadow: `0 0 ${Math.round(size / 3)}px -2px ${frame.glow}`, borderRadius: "inherit" }}
          data-frame
        >
          <span
            aria-hidden
            className={`absolute -inset-1/2 ${frame.spin ? "animate-[spin_6s_linear_infinite]" : ""}`}
            style={{ background: frame.gradient }}
          />
          <span className="relative">{face}</span>
        </span>
      ) : (
        face
      )}
      {badge && (
        <span
          className="absolute -bottom-1 -right-1 grid place-items-center rounded-full border border-bg shadow"
          style={{ width: badgeSize, height: badgeSize, background: badge.bg, fontSize: badgeSize * 0.62, lineHeight: 1 }}
          data-badge
        >
          {badge.icon}
        </span>
      )}
    </span>
  );
}

/** Title kosmetik pemain (mis. "Arena Legend"), kosong jika tidak dipakai. */
export function PlayerTitle({ address, className = "" }: { address?: string | null; className?: string }) {
  const { title } = useEquipped(address);
  const { data: info } = useRewardsInfo();
  if (!title) return null;
  const item = info?.cosmetics.find((c) => c.id === title);
  if (!item) return null;
  const s = titleStyle(item.rarity);
  return (
    <span className={`eyebrow text-[10px] ${s.className} ${className}`} style={s.style} data-testid="player-title">
      {item.name}
    </span>
  );
}

"use client";

import { PRIZE_ORDER, type Prize } from "@/lib/rewards";

/** Label pendek di roda (urutan segmen = PRIZE_ORDER). */
const SHORT: Record<Prize, string> = {
  try_again: "TRY AGAIN",
  fee_free_1: "1 FREE FEE",
  fee_free_3: "3 FREE FEES",
  xp_50: "+50 XP",
  xp_150: "+150 XP",
  cosmetic: "COSMETIC",
  rivl_10k: "10K RIVL",
  rivl_50k: "50K RIVL",
  jackpot: "JACKPOT",
};

const FILL: Record<Prize, string> = {
  try_again: "#1b1e25",
  fee_free_1: "#2c1214",
  fee_free_3: "#4a1418",
  xp_50: "#111b33",
  xp_150: "#16264d",
  cosmetic: "#2a1a3d",
  rivl_10k: "#3a2c08",
  rivl_50k: "#5a4209",
  jackpot: "#b8860b",
};

export const SEGMENT_DEG = 360 / PRIZE_ORDER.length;

/** Sudut akhir roda supaya penunjuk (atas) berhenti di tengah segmen hadiah, setelah beberapa putaran penuh. */
export function targetRotation(current: number, prize: Prize): number {
  const i = PRIZE_ORDER.indexOf(prize);
  const center = i * SEGMENT_DEG + SEGMENT_DEG / 2;
  const jitter = (Math.random() - 0.5) * SEGMENT_DEG * 0.6;
  const want = (360 - center + jitter + 360) % 360;
  const base = current - (current % 360);
  return base + 360 * 6 + want;
}

export function SpinWheel({ rotation, spinning, size = 320 }: { rotation: number; spinning: boolean; size?: number }) {
  const r = 100;
  const seg = (i: number) => {
    const a0 = ((i * SEGMENT_DEG - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * SEGMENT_DEG - 90) * Math.PI) / 180;
    return `M0 0 L${r * Math.cos(a0)} ${r * Math.sin(a0)} A${r} ${r} 0 0 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`;
  };
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} data-testid="spin-wheel">
      <div
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: "0 0 80px -10px rgb(229 72 77 / 0.45), 0 0 0 6px #23272f, 0 0 0 10px #101216" }}
      />
      <svg
        viewBox="-104 -104 208 208"
        width={size}
        height={size}
        className="relative"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning ? "transform 4.6s cubic-bezier(0.12, 0.6, 0.08, 1)" : "none",
        }}
        aria-hidden
      >
        {PRIZE_ORDER.map((p, i) => {
          const mid = i * SEGMENT_DEG + SEGMENT_DEG / 2;
          return (
            <g key={p}>
              <path d={seg(i)} fill={FILL[p]} stroke="#08090b" strokeWidth={1.2} />
              <text
                transform={`rotate(${mid}) translate(0 -62) rotate(90)`}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={p === "jackpot" ? "#fff7d1" : "#eef0f4"}
                fontSize={p === "jackpot" ? 9 : 7.5}
                fontWeight={900}
                letterSpacing={0.4}
                style={{ fontFamily: "var(--font-display, sans-serif)" }}
              >
                {SHORT[p]}
              </text>
            </g>
          );
        })}
        <circle r={22} fill="#08090b" stroke="#363b45" strokeWidth={2} />
        <text textAnchor="middle" dominantBaseline="central" fill="#eef0f4" fontSize={11} fontWeight={900}>
          RIVL
        </text>
      </svg>
      {/* Penunjuk */}
      <svg aria-hidden viewBox="0 0 24 30" width={28} height={34} className="absolute left-1/2 -top-3 -translate-x-1/2 drop-shadow-[0_4px_8px_rgb(0_0_0/0.6)]">
        <path d="M12 30 L2 6 Q12 -4 22 6 Z" fill="#e5484d" stroke="#08090b" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

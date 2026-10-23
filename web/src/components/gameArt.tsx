"use client";

import { useId, type ReactNode } from "react";

import type { Game } from "@/lib/duel";

/*
 * Ilustrasi dekoratif untuk kartu game di lobby (inline SVG, tanpa file gambar).
 * Warna dari token tema: merah = sudut pembuat, biru = sudut penantang (docs/spec.md 5.5: gelap, tegas,
 * tanpa koin emas berhamburan atau lampu kedip). Tidak menampilkan hasil duel apa pun.
 */

const RED = "var(--color-red)";
const RED_BRIGHT = "var(--color-red-bright)";
const BLUE = "var(--color-blue)";
const BLUE_BRIGHT = "var(--color-blue-bright)";
const INK = "var(--color-ink)";
const LINE = "var(--color-line-strong)";
const FAINT = "var(--color-faint)";
const BG = "var(--color-bg)";
const DISPLAY = { fontFamily: "var(--font-display)", fontStretch: "125%", fontWeight: 900 } as const;

// ---------------------------------------------------------------------------
// Game yang sudah live
// ---------------------------------------------------------------------------

/** Panggung animasi untuk kartu "Pick your game". */
export function LiveGameArt({ game }: { game: Game }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 400 190" className="block h-full w-full" role="img" aria-label={`${game} illustration`}>
      <defs>
        <radialGradient id={`${id}-l`} cx="0" cy="0.5" r="0.75">
          <stop offset="0" stopColor={RED} stopOpacity="0.38" />
          <stop offset="1" stopColor={RED} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-r`} cx="1" cy="0.5" r="0.75">
          <stop offset="0" stopColor={BLUE} stopOpacity="0.36" />
          <stop offset="1" stopColor={BLUE} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-steel`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f6fa" />
          <stop offset="0.45" stopColor="#aab1bd" />
          <stop offset="1" stopColor="#5b6270" />
        </linearGradient>
        <pattern id={`${id}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#ffffff" strokeOpacity="0.035" />
        </pattern>
      </defs>
      <rect width="400" height="190" fill={BG} />
      <rect width="400" height="190" fill={`url(#${id}-grid)`} />
      <rect width="400" height="190" fill={`url(#${id}-l)`} />
      <rect width="400" height="190" fill={`url(#${id}-r)`} />
      <line x1="200" y1="14" x2="200" y2="176" stroke={LINE} strokeDasharray="3 6" />
      {game === "Coinflip" && <CoinScene steel={`url(#${id}-steel)`} />}
      {game === "Dice" && <DiceScene />}
      {game === "Suit" && <SuitScene />}
    </svg>
  );
}

function CornerTag({ x, label, color }: { x: number; label: string; color: string }) {
  return (
    <g>
      <rect x={x - 38} y="150" width="76" height="22" rx="11" fill={BG} fillOpacity="0.7" stroke={color} strokeOpacity="0.6" />
      <text x={x} y="165" textAnchor="middle" fontSize="10" letterSpacing="2" fill={color} style={DISPLAY}>
        {label}
      </text>
    </g>
  );
}

function CoinScene({ steel }: { steel: string }) {
  return (
    <g>
      <CornerTag x={80} label="HEADS" color={RED_BRIGHT} />
      <CornerTag x={320} label="TAILS" color={BLUE_BRIGHT} />
      <ellipse cx="200" cy="160" rx="46" ry="7" fill="#000" opacity="0.5" />
      <g className="art-float">
        <g className="art-flip" style={{ transformOrigin: "200px 88px" }}>
          <circle cx="200" cy="88" r="52" fill={steel} />
          <circle cx="200" cy="88" r="44" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="2" />
          <circle cx="200" cy="88" r="52" fill="none" stroke={RED} strokeWidth="3" strokeDasharray="82 82" />
          <circle cx="200" cy="88" r="52" fill="none" stroke={BLUE} strokeWidth="3" strokeDasharray="82 82" strokeDashoffset="82" />
          <text x="200" y="104" textAnchor="middle" fontSize="46" fill="#2b3038" style={DISPLAY}>
            H
          </text>
        </g>
      </g>
      <path d="M118 66l10 4M112 92h12M118 118l10-4M282 66l-10 4M288 92h-12M282 118l-10-4" stroke={INK} strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function Die({ x, y, color, glow, pips, rotate, delay }: { x: number; y: number; color: string; glow: string; pips: [number, number][]; rotate: number; delay: string }) {
  return (
    <g className="art-float" style={{ animationDelay: delay }}>
      <g transform={`rotate(${rotate} ${x + 40} ${y + 40})`}>
        <rect x={x + 4} y={y + 8} width="80" height="80" rx="18" fill="#000" opacity="0.45" />
        <rect x={x} y={y} width="80" height="80" rx="18" fill={BG} stroke={color} strokeWidth="3" />
        <rect x={x + 3} y={y + 3} width="74" height="74" rx="15" fill={glow} fillOpacity="0.12" />
        {pips.map(([px, py], i) => (
          <circle key={i} cx={x + px} cy={y + py} r="6.5" fill={INK} />
        ))}
      </g>
    </g>
  );
}

function DiceScene() {
  const five: [number, number][] = [[20, 20], [60, 20], [40, 40], [20, 60], [60, 60]];
  const six: [number, number][] = [[22, 18], [58, 18], [22, 40], [58, 40], [22, 62], [58, 62]];
  return (
    <g>
      <Die x={72} y={42} color={RED} glow={RED} pips={five} rotate={-12} delay="0s" />
      <Die x={248} y={42} color={BLUE} glow={BLUE} pips={six} rotate={10} delay="-1.4s" />
      <text x="200" y="104" textAnchor="middle" fontSize="26" fill={INK} fillOpacity="0.85" style={DISPLAY}>
        VS
      </text>
      <text x="200" y="168" textAnchor="middle" fontSize="11" letterSpacing="3" fill={FAINT} style={DISPLAY}>
        1 – 100 · HIGH ROLL WINS
      </text>
    </g>
  );
}

function SuitScene() {
  return (
    <g>
      {/* Batu (merah) */}
      <g className="art-float">
        <g transform="translate(58 38) scale(4.6)" fill="none" stroke={RED_BRIGHT} strokeWidth="1.6" strokeLinejoin="round">
          <path d="M5 13c0-3 1.5-6 5-7 2.5-.7 6 .2 7.5 2.5S19.5 14 18 16.5 13.5 20 10 19.5 5 16 5 13z" fill={RED} fillOpacity="0.16" />
          <path d="M9 10.5c1 .5 2.5.6 4 0M10 14.5c1.2.4 2.6.3 3.8-.3" />
        </g>
      </g>
      {/* Gunting (biru) */}
      <g className="art-float" style={{ animationDelay: "-1.4s" }}>
        <g transform="translate(232 38) scale(4.6)" fill="none" stroke={BLUE_BRIGHT} strokeWidth="1.6" strokeLinecap="round">
          <circle cx="6.5" cy="17.5" r="2.5" fill={BLUE} fillOpacity="0.16" />
          <circle cx="17.5" cy="17.5" r="2.5" fill={BLUE} fillOpacity="0.16" />
          <path d="M8.3 15.7L18 4M15.7 15.7L6 4" />
        </g>
      </g>
      <g className="art-pulse" style={{ transformOrigin: "200px 92px" }}>
        <path d="M200 66l7 18 18 2-14 11 5 18-16-10-16 10 5-18-14-11 18-2z" fill={INK} fillOpacity="0.08" stroke={INK} strokeOpacity="0.4" />
        <text x="200" y="101" textAnchor="middle" fontSize="20" fill={INK} style={DISPLAY}>
          VS
        </text>
      </g>
      <text x="200" y="168" textAnchor="middle" fontSize="11" letterSpacing="3" fill={FAINT} style={DISPLAY}>
        HIDDEN MOVE · REVEAL TO WIN
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Coming Soon (statis, lebih redup)
// ---------------------------------------------------------------------------

/** Ilustrasi kecil untuk kartu Coming Soon. Statis dan sedikit redup supaya beda dari game yang live. */
export function ComingSoonArt({ name }: { name: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 320 140" className="block h-full w-full" role="img" aria-label={`${name} illustration`}>
      <defs>
        <radialGradient id={`${id}-g`} cx="0.5" cy="0.45" r="0.7">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="320" height="140" fill={BG} fillOpacity="0.6" />
      <rect width="320" height="140" fill={`url(#${id}-g)`} />
      <g opacity="0.9">{COMING_ART[name] ?? null}</g>
    </svg>
  );
}

function Card({ x, y, rotate, face, color }: { x: number; y: number; rotate: number; face?: { rank: string; suit: string }; color: string }) {
  return (
    <g transform={`rotate(${rotate} ${x + 32} ${y + 44})`}>
      <rect x={x + 3} y={y + 5} width="64" height="88" rx="9" fill="#000" opacity="0.4" />
      <rect x={x} y={y} width="64" height="88" rx="9" fill={face ? "#eceff4" : BG} stroke={color} strokeWidth="2.5" />
      {face ? (
        <>
          <text x={x + 9} y={y + 22} fontSize="17" fill="#15181d" style={DISPLAY}>
            {face.rank}
          </text>
          <text x={x + 32} y={y + 60} textAnchor="middle" fontSize="30" fill={RED}>
            {face.suit}
          </text>
        </>
      ) : (
        <>
          <rect x={x + 7} y={y + 7} width="50" height="74" rx="5" fill="none" stroke={color} strokeOpacity="0.5" />
          <path d={`M${x + 7} ${y + 30}l25-23 25 23M${x + 7} ${y + 58}l25 23 25-23`} stroke={color} strokeOpacity="0.35" fill="none" />
          <text x={x + 32} y={y + 52} textAnchor="middle" fontSize="20" fill={color} style={DISPLAY}>
            ?
          </text>
        </>
      )}
    </g>
  );
}

const COMING_ART: Record<string, ReactNode> = {
  "High Card": (
    <g>
      <Card x={96} y={24} rotate={-10} face={{ rank: "A", suit: "♥" }} color={RED} />
      <Card x={162} y={24} rotate={9} color={BLUE} />
    </g>
  ),
  "Battle Royale": (
    <g>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const cx = 160 + Math.cos(a) * 92;
        const cy = 70 + Math.sin(a) * 50;
        const out = i % 3 !== 0;
        return (
          <g key={i} opacity={out ? 0.45 : 1}>
            <circle cx={cx} cy={cy} r="11" fill={BG} stroke={out ? FAINT : i % 2 ? BLUE : RED} strokeWidth="2" />
            {out && <path d={`M${cx - 5} ${cy - 5}l10 10M${cx + 5} ${cy - 5}l-10 10`} stroke={FAINT} strokeWidth="2" strokeLinecap="round" />}
          </g>
        );
      })}
      <path d="M144 62l6 8 10-14 10 14 6-8-3 18h-26z" fill={RED} fillOpacity="0.2" stroke={RED_BRIGHT} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="160" cy="94" r="12" fill={BG} stroke={RED_BRIGHT} strokeWidth="2.5" />
    </g>
  ),
  "Mines Duel": (
    <g>
      {Array.from({ length: 15 }, (_, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const x = 82 + col * 32;
        const y = 22 + row * 32;
        const kind = i === 7 ? "mine" : [1, 5, 11].includes(i) ? "red" : [3, 9, 13].includes(i) ? "blue" : "hidden";
        return (
          <g key={i}>
            <rect x={x} y={y} width="26" height="26" rx="6" fill={kind === "hidden" ? "#171a20" : BG} stroke={kind === "red" ? RED : kind === "blue" ? BLUE : kind === "mine" ? RED_BRIGHT : LINE} strokeWidth={kind === "hidden" ? 1 : 2} />
            {kind === "red" || kind === "blue" ? (
              <path d={`M${x + 7} ${y + 13}l4 4 8-9`} stroke={kind === "red" ? RED_BRIGHT : BLUE_BRIGHT} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ) : null}
            {kind === "mine" && (
              <g stroke={RED_BRIGHT} strokeWidth="2" strokeLinecap="round">
                <circle cx={x + 13} cy={y + 13} r="5" fill={RED} />
                <path d={`M${x + 13} ${y + 4}v3M${x + 13} ${y + 19}v3M${x + 4} ${y + 13}h3M${x + 19} ${y + 13}h3`} />
              </g>
            )}
          </g>
        );
      })}
    </g>
  ),
  "Memecoin Jackpot": (
    <g>
      {[
        { x: 118, y: 28, c: RED, t: "M" },
        { x: 160, y: 16, c: INK, t: "D" },
        { x: 202, y: 28, c: BLUE, t: "P" },
      ].map((tk) => (
        <g key={tk.t}>
          <circle cx={tk.x} cy={tk.y + 12} r="14" fill={BG} stroke={tk.c} strokeWidth="2.5" />
          <text x={tk.x} y={tk.y + 17} textAnchor="middle" fontSize="13" fill={tk.c} style={DISPLAY}>
            {tk.t}
          </text>
          <path d={`M${tk.x} ${tk.y + 30}v10`} stroke={tk.c} strokeOpacity="0.5" strokeWidth="2" strokeDasharray="2 4" strokeLinecap="round" />
        </g>
      ))}
      <path d="M104 74h112l-12 50h-88z" fill="#171a20" stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
      <path d="M100 74h120" stroke={INK} strokeOpacity="0.5" strokeWidth="3" strokeLinecap="round" />
      <text x="160" y="106" textAnchor="middle" fontSize="13" letterSpacing="2" fill={INK} fillOpacity="0.8" style={DISPLAY}>
        POT
      </text>
    </g>
  ),
  "Stock Price Arena": (
    <g>
      <path d="M40 116h240" stroke={LINE} />
      {[
        { x: 70, o: 86, c: 70, h: 62, l: 94 },
        { x: 100, o: 72, c: 80, h: 64, l: 90 },
        { x: 130, o: 80, c: 58, h: 50, l: 86 },
        { x: 160, o: 60, c: 66, h: 52, l: 74 },
        { x: 190, o: 64, c: 44, h: 36, l: 70 },
        { x: 220, o: 46, c: 30, h: 22, l: 52 },
      ].map((k) => {
        const up = k.c < k.o;
        const color = up ? BLUE : RED;
        return (
          <g key={k.x}>
            <path d={`M${k.x} ${k.h}V${k.l}`} stroke={color} strokeWidth="2" />
            <rect x={k.x - 7} y={Math.min(k.o, k.c)} width="14" height={Math.max(4, Math.abs(k.o - k.c))} rx="2" fill={color} fillOpacity={up ? 0.85 : 0.6} />
          </g>
        );
      })}
      <g>
        <rect x="244" y="24" width="50" height="22" rx="11" fill={BG} stroke={BLUE} />
        <text x="269" y="39" textAnchor="middle" fontSize="10" letterSpacing="2" fill={BLUE_BRIGHT} style={DISPLAY}>
          UP
        </text>
        <rect x="244" y="54" width="50" height="22" rx="11" fill={BG} stroke={RED} strokeOpacity="0.7" />
        <text x="269" y="69" textAnchor="middle" fontSize="10" letterSpacing="2" fill={RED_BRIGHT} style={DISPLAY}>
          DOWN
        </text>
      </g>
    </g>
  ),
  Casino: (
    <g>
      <circle cx="160" cy="70" r="54" fill="#171a20" stroke={LINE} strokeWidth="2" />
      {Array.from({ length: 16 }, (_, i) => {
        const a0 = (i / 16) * Math.PI * 2;
        const a1 = ((i + 1) / 16) * Math.PI * 2;
        const p = (a: number, r: number) => `${160 + Math.cos(a) * r} ${70 + Math.sin(a) * r}`;
        return (
          <path
            key={i}
            d={`M${p(a0, 30)}L${p(a0, 50)}A50 50 0 0 1 ${p(a1, 50)}L${p(a1, 30)}A30 30 0 0 0 ${p(a0, 30)}z`}
            fill={i % 2 ? RED : BG}
            fillOpacity={i % 2 ? 0.7 : 1}
            stroke={LINE}
            strokeWidth="0.8"
          />
        );
      })}
      <circle cx="160" cy="70" r="26" fill={BG} stroke={LINE} />
      <path d="M160 52v36M142 70h36" stroke={INK} strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" />
      <circle cx="160" cy="70" r="5" fill={INK} fillOpacity="0.8" />
      <circle cx="196" cy="34" r="5" fill="#eceff4" />
    </g>
  ),
  Referral: (
    <g>
      <g>
        <circle cx="100" cy="56" r="16" fill={BG} stroke={RED} strokeWidth="2.5" />
        <path d="M74 104c4-16 14-24 26-24s22 8 26 24" fill="none" stroke={RED} strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <g>
        <circle cx="220" cy="56" r="16" fill={BG} stroke={BLUE} strokeWidth="2.5" />
        <path d="M194 104c4-16 14-24 26-24s22 8 26 24" fill="none" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <path d="M128 64h56" stroke={INK} strokeOpacity="0.4" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" />
      <path d="M176 58l8 6-8 6" fill="none" stroke={INK} strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="160" cy="98" r="15" fill={BG} stroke={INK} strokeOpacity="0.6" strokeWidth="2" />
      <text x="160" y="104" textAnchor="middle" fontSize="15" fill={INK} style={DISPLAY}>
        %
      </text>
    </g>
  ),
};

import { useMemo } from "react";
import { hexToBytes, keccak256, type Hex } from "viem";

type Corner = "red" | "blue" | "neutral";

const TONES: Record<Corner, { fg: string; bg: string; ring: string }> = {
  red: { fg: "#ff6369", bg: "#2c1214", ring: "ring-red/60" },
  blue: { fg: "#7096ff", bg: "#111b33", ring: "ring-blue/60" },
  neutral: { fg: "#c9ced8", bg: "#171a20", ring: "ring-line-strong" },
};

/**
 * Identicon 5×5 simetris dari hash alamat. Bentuk unik per alamat, warna mengikuti sudut arena.
 * Tanpa alamat (slot penantang kosong): tanda tanya di atas pola diagonal.
 */
export function Avatar({
  address,
  corner = "neutral",
  size = 40,
  className = "",
}: {
  address?: string | null;
  corner?: Corner;
  size?: number;
  className?: string;
}) {
  const tone = TONES[corner];
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

  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-xl ring-2 ${tone.ring} ${address ? "" : "hatch"} ${className}`}
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
}

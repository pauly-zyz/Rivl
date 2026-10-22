import type { Game } from "@/lib/duel";

/** Ikon game sederhana, satu warna (currentColor). */
export function GameIcon({ game, className = "h-5 w-5" }: { game: Game; className?: string }) {
  if (game === "Coinflip") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <ellipse cx="12" cy="12" rx="8" ry="9" />
        <path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" />
      </svg>
    );
  }
  if (game === "Dice") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <circle cx="9" cy="9" r="1.2" fill="currentColor" />
        <circle cx="15" cy="15" r="1.2" fill="currentColor" />
        <circle cx="15" cy="9" r="1.2" fill="currentColor" />
        <circle cx="9" cy="15" r="1.2" fill="currentColor" />
      </svg>
    );
  }
  return <MoveIcon move={1} className={className} />;
}

/** 1 = Rock, 2 = Paper, 3 = Scissors. Selain itu: tanda tanya (belum dibuka). */
export function MoveIcon({ move, className = "h-6 w-6" }: { move: number | null | undefined; className?: string }) {
  if (move === 1) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
        <path d="M5 13c0-3 1.5-6 5-7 2.5-.7 6 .2 7.5 2.5S19.5 14 18 16.5 13.5 20 10 19.5 5 16 5 13z" />
        <path d="M9 10.5c1 .5 2.5.6 4 0M10 14.5c1.2.4 2.6.3 3.8-.3" />
      </svg>
    );
  }
  if (move === 2) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M15 3v4h4M9 11h7M9 14.5h7M9 18h5" />
      </svg>
    );
  }
  if (move === 3) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="6.5" cy="17.5" r="2.5" />
        <circle cx="17.5" cy="17.5" r="2.5" />
        <path d="M8.3 15.7L18 4M15.7 15.7L6 4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M9 9a3 3 0 115 2.2c-1.2.8-2 1.5-2 2.8M12 17.5v.5" />
    </svg>
  );
}

import type { ReactNode } from "react";

import { SectionTitle } from "./ui";
import { COMING_SOON } from "@/lib/comingSoon";
import { configResult } from "@/lib/config";

/** Ikon sederhana per fitur (dekoratif). */
const ICONS: Record<string, ReactNode> = {
  "High Card": <path d="M6 4h9l3 3v13H6zM10 10l2-2 2 2-2 4z" />,
  "Battle Royale": <path d="M4 9l4 3 4-6 4 6 4-3-2 10H6zM6 19h12" />,
  "Mines Duel": <path d="M12 7a5 5 0 110 10 5 5 0 010-10zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2" />,
  "Memecoin Jackpot": <path d="M5 10h14l-1.5 9h-11zM8 10V7a4 4 0 018 0v3M12 13v3" />,
  "Stock Price Arena": <path d="M4 19h16M5 15l4-4 3 3 7-7M15 7h4v4" />,
  Casino: <path d="M12 3a9 9 0 110 18 9 9 0 010-18zM12 7v2M12 15v2M7 12h2M15 12h2M12 10a2 2 0 110 4 2 2 0 010-4z" />,
  Referral: <path d="M9 11a3 3 0 100-6 3 3 0 000 6zM3 19c0-3 3-5 6-5s6 2 6 5M17 8v6M14 11h6" />,
};

/** Kartu Coming Soon (docs/spec.md bagian 1). HANYA kartu: tidak ada logika game. */
export function ComingSoon() {
  const xUrl = configResult.ok ? configResult.config.xUrl : undefined;

  return (
    <section aria-labelledby="coming-soon">
      <SectionTitle>
        <span id="coming-soon">Coming soon</span>
      </SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {COMING_SOON.map((f) => (
          <article
            key={f.name}
            className="hatch card-lift relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface/70 p-4"
            data-testid="coming-soon-card"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-line-strong bg-bg/60 text-muted">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {ICONS[f.name]}
                </svg>
              </span>
              <span className="rounded-full border border-line-strong bg-bg/60 px-2 py-0.5 font-display-condensed text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                Soon
              </span>
            </div>
            <h3 className="font-display mt-4 text-lg font-black">{f.name}</h3>
            <p className="mt-1.5 flex-1 text-sm text-muted">{f.text}</p>
            {xUrl ? (
              <a
                href={xUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex h-9 items-center justify-center rounded-xl border border-line-strong bg-bg/60 text-sm font-semibold text-ink transition-colors hover:border-muted"
              >
                Notify me
              </a>
            ) : (
              <span
                aria-disabled
                title="Set NEXT_PUBLIC_X_URL to enable"
                className="mt-4 inline-flex h-9 cursor-not-allowed items-center justify-center rounded-xl border border-line text-sm font-semibold text-faint"
              >
                Notify me
              </span>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

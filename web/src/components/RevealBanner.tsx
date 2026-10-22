"use client";

import Link from "next/link";
import { useAccount } from "wagmi";

import { useNow } from "@/hooks/useArena";
import { useSuitSecrets } from "@/hooks/useSuitSecrets";
import { formatDuration } from "@/lib/format";
import { usePendingReveals } from "@/lib/indexer";

/**
 * "You need to reveal" (docs/spec.md 5.3 langkah 6): setiap kali aplikasi dibuka, cek duel Suit milik
 * pengguna yang sudah diterima lawan dan tampilkan hitung mundur.
 */
export function RevealBanner() {
  const { address } = useAccount();
  const { data } = usePendingReveals(address);
  const { find } = useSuitSecrets();
  const now = useNow();

  const pending = (data ?? []).filter((d) => now === undefined || Number(d.deadline) >= now);
  if (!address || pending.length === 0) return null;

  return (
    <div className="border-b border-red/40 bg-red-deep" role="alert" data-testid="reveal-banner">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:px-6">
        {pending.map((d) => {
          const left = now === undefined ? undefined : Number(d.deadline) - now;
          const hasSecret = !!find(d.commit);
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="font-bold">
                You need to reveal <span className="text-muted">· Suit #{d.id}</span>
              </p>
              <p className="tabular text-sm text-ink/80">
                {left === undefined ? "…" : `${formatDuration(left)} left — if you don't reveal, your rival wins.`}
              </p>
              {!hasSecret && (
                <p className="text-sm text-red">Your move isn&apos;t saved in this browser. Restore your backup.</p>
              )}
              <Link
                href={hasSecret ? `/duel/${d.id}` : "/me#backup"}
                className="ml-auto rounded-lg bg-red px-3 py-1.5 text-sm font-bold text-white hover:bg-[#f05a5f]"
              >
                {hasSecret ? "Reveal now" : "Restore backup"}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

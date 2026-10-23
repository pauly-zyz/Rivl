"use client";

import { duelArenaAbi } from "@rivl/contracts/abi";
import Link from "next/link";
import { useEffect } from "react";
import { useAccount } from "wagmi";

import { TxNotice } from "./ui";
import { useNow } from "@/hooks/useArena";
import { useAwaitingReveal } from "@/hooks/useAwaitingReveal";
import { useSuitSecrets } from "@/hooks/useSuitSecrets";
import { useTx } from "@/hooks/useTx";
import { appConfig } from "@/lib/config";
import { formatDuration } from "@/lib/format";

/** Duel yang sudah dicoba di-reveal otomatis pada pemuatan halaman ini (supaya wallet tidak diminta berulang). */
const autoRevealTried = new Set<string>();

/**
 * "You need to reveal" (docs/spec.md 5.3 langkah 6) + auto-reveal.
 * Begitu lawan bergabung di duel milik pengguna dan rahasianya ada di browser ini, transaksi reveal langsung
 * dikirim ke wallet untuk dikonfirmasi — pembuat tidak perlu mencari duelnya. Jika ditolak, tombol tetap ada.
 */
export function RevealBanner() {
  const { address } = useAccount();
  const data = useAwaitingReveal(address);
  const { find } = useSuitSecrets();
  const now = useNow();
  const tx = useTx();

  const pending = data.filter((d) => now === undefined || Number(d.deadline) >= now);

  useEffect(() => {
    if (!address || tx.busy) return;
    const next = pending.find((d) => find(d.commit) && !autoRevealTried.has(`${address}:${d.id}`));
    if (!next) return;
    const secret = find(next.commit)!;
    autoRevealTried.add(`${address}:${next.id}`);
    tx.send("Reveal", {
      address: appConfig().arena,
      abi: duelArenaAbi,
      functionName: "reveal",
      args: [BigInt(next.id), secret.move, secret.salt],
    }).catch(() => {
      /* ditolak atau gagal: tombol "Reveal now" tetap tersedia */
    });
  }, [address, pending, find, tx]);

  // Pesan sukses cukup tampil sebentar; hasil duel terlihat di halaman duel dan My duels.
  const { status } = tx.state;
  const { reset } = tx;
  useEffect(() => {
    if (status !== "success") return;
    const t = setTimeout(reset, 4_000);
    return () => clearTimeout(t);
  }, [status, reset]);

  if (!address || (pending.length === 0 && tx.state.status === "idle")) return null;

  return (
    <div className="border-b border-red/40 bg-red-deep" role="alert" data-testid="reveal-banner">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:px-6">
        {pending.map((d) => {
          const left = now === undefined ? undefined : Number(d.deadline) - now;
          const hasSecret = !!find(d.commit);
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="font-bold">
                You need to reveal{" "}
                <span className="text-muted">· {d.game === "Dice" ? "Dice Duel" : d.game} #{d.id}</span>
              </p>
              <p className="tabular text-sm text-ink/80">
                {left === undefined ? "…" : `${formatDuration(left)} left — if you don't reveal, your rival wins.`}
              </p>
              {!hasSecret && (
                <p className="text-sm text-red">Your secret isn&apos;t saved in this browser. Restore your backup.</p>
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
        <TxNotice state={tx.state} />
      </div>
    </div>
  );
}

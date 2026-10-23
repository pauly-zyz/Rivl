"use client";

import { duelArenaAbi } from "@rivl/contracts/abi";
import Link from "next/link";
import type { ReactNode } from "react";
import { useReadContracts } from "wagmi";

import { GameIcon } from "@/components/icons";
import { Card, SectionTitle } from "@/components/ui";
import { useArenaInfo } from "@/hooks/useArena";
import { appConfig } from "@/lib/config";
import { formatAmount, formatDuration } from "@/lib/format";

/** Aturan, fee, batas waktu, dan FAQ. Angka dibaca langsung dari contract supaya selalu sesuai. */
export default function RulesPage() {
  const { arena } = appConfig();
  const { tokens, feeBps } = useArenaInfo();
  const { data: t } = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: arena, abi: duelArenaAbi, functionName: "openDuration" },
      { address: arena, abi: duelArenaAbi, functionName: "revealWindow" },
    ],
  });
  const dur = (i: 0 | 1) => (t ? formatDuration(Number(t[i])) : "…");
  const fee = feeBps !== undefined ? `${feeBps / 100}%` : "…";

  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header>
        <h1 className="font-display text-3xl font-black sm:text-5xl">Rules</h1>
        <p className="mt-3 text-muted">
          Every duel is one player against one player. Both stakes are locked in the smart contract, the result is
          decided on chain, and the winner takes the pot minus a {fee} fee. Rivl never plays against you.
        </p>
      </header>

      <section>
        <SectionTitle>How a duel works</SectionTitle>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink/90">
          <li>You create a duel: pick a game, ETH or USDG, a stake, and your side or move. Your stake is locked.</li>
          <li>Another player joins with the same stake. You can&apos;t join your own duel.</li>
          <li>
            You come back and reveal the secret your browser locked in when you created the duel. The contract checks it
            and decides the result on the spot. If you don&apos;t reveal in time, your rival wins.
          </li>
          <li>Winnings and draws are credited to your balance. Claim them any time from My duels.</li>
        </ol>
      </section>

      <section className="space-y-3">
        <SectionTitle>Games</SectionTitle>
        <Game icon="Coinflip" title="Coinflip">
          The creator calls <b>Heads</b> or <b>Tails</b>; the rival gets the other side. The creator locks in a secret
          salt, the rival adds a random seed, and <code>randomWord = keccak256(salt, seed)</code>. The coin is{" "}
          <code>randomWord % 2</code> (0 = Heads, 1 = Tails). No draws.
        </Game>
        <Game icon="Dice" title="Dice Duel">
          Nobody picks anything. The random word comes from the creator&apos;s secret salt and the rival&apos;s seed, as
          in Coinflip, and gives both rolls: creator ={" "}
          <code>uint128(randomWord) % 100 + 1</code>, rival = <code>(randomWord &gt;&gt; 128) % 100 + 1</code>. Highest
          number wins. Same number is a draw: both stakes are returned with no fee.
        </Game>
        <Game icon="Suit" title="Suit (rock, paper, scissors)">
          The creator commits a hidden move; the rival then picks openly. The creator reveals the move and salt, and the
          contract checks them against the commit. Paper beats Rock, Scissors beat Paper, Rock beats Scissors. Same move
          is a draw with no fee. If the creator doesn&apos;t reveal within {dur(1)} — or reveals an invalid move — the
          rival wins.
        </Game>
      </section>

      <section>
        <SectionTitle>Fees</SectionTitle>
        <Card className="space-y-2 p-4 text-sm">
          <p>
            The fee is <b>{fee} of the pot</b>, taken only when there is a winner. The winner receives{" "}
            <code>2 × stake − fee</code>. Example: 100 USDG vs 100 USDG → winner gets 195 USDG, fee 5 USDG.
          </p>
          <p className="text-muted">
            No fee on draws or cancelled duels. The fee is locked when a duel is created, and the contract caps
            it at 10%.
          </p>
        </Card>
      </section>

      <section>
        <SectionTitle>Time limits</SectionTitle>
        <Card className="divide-y divide-line text-sm">
          <Limit label="An open duel can be joined for" value={dur(0)} note="The creator can cancel any time before someone joins, even after it expires." />
          <Limit label="After someone joins, the creator must reveal within" value={dur(1)} note="All games. After that, anyone can settle the duel and the rival wins." />
        </Card>
      </section>

      <section>
        <SectionTitle>Stake limits per player</SectionTitle>
        <Card className="divide-y divide-line text-sm">
          {tokens.map((tk) => (
            <div key={tk.address} className="tabular flex justify-between px-4 py-3">
              <span className="font-bold">{tk.symbol}</span>
              <span>
                {formatAmount(tk.minStake, tk.decimals)} – {formatAmount(tk.maxStake, tk.decimals)} {tk.symbol}
              </span>
            </div>
          ))}
        </Card>
      </section>

      <section>
        <SectionTitle>FAQ</SectionTitle>
        <div className="space-y-2">
          <Faq q="Can Rivl take or freeze my funds?">
            No. The contract has no function that lets the owner take player funds, and every waiting state has a
            deadline with an exit anyone can trigger. Pausing only stops new duels; cancelling, revealing, timeouts and
            claims keep working.
          </Faq>
          <Faq q="How do I know a result was fair?">
            Every result comes from the two players: the creator&apos;s hidden secret and the rival&apos;s choice or
            random seed. There is no oracle or operator, so nobody — including Rivl — can pick or know the result in
            advance. Check any duel on the{" "}
            <Link href="/fair" className="text-blue underline">
              Provably fair
            </Link>{" "}
            page.
          </Faq>
          <Faq q="Why do I have to come back after someone joins?">
            Your secret (and your move in Suit) is hidden as a hash so your rival can&apos;t see it. Only you have the
            salt that opens it, so you must reveal it after someone joins. If you don&apos;t reveal in time, your rival
            wins.
          </Faq>
          <Faq q="What if I lose my secret?">
            Your secrets are saved in your browser. Back them up from My duels and restore the file on another device.
            Without them you can&apos;t reveal and you will lose by timeout.
          </Faq>
          <Faq q="Where do my winnings go?">
            They are credited to your claimable balance in the contract. Use Claim on My duels to send them to your
            wallet. There is no expiry.
          </Faq>
          <Faq q="Which tokens can I use?">ETH and USDG, within the stake limits above.</Faq>
          <Faq q="Can I set my own limits?">
            Yes. Set a daily stake limit or take a break on{" "}
            <Link href="/me#limits" className="text-blue underline">
              My duels
            </Link>
            .
          </Faq>
        </div>
      </section>
    </article>
  );
}

function Game({ icon, title, children }: { icon: "Coinflip" | "Dice" | "Suit"; title: string; children: ReactNode }) {
  return (
    <Card className="flex gap-3 p-4">
      <GameIcon game={icon} className="mt-0.5 h-6 w-6 shrink-0 text-red" />
      <div>
        <h3 className="font-bold">{title}</h3>
        <p className="mt-1 text-sm text-ink/85 [&_code]:break-words [&_code]:text-muted">{children}</p>
      </div>
    </Card>
  );
}

function Limit({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="px-4 py-3">
      <div className="flex justify-between gap-3">
        <span>{label}</span>
        <b className="tabular shrink-0">{value}</b>
      </div>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-line bg-surface px-4 py-3">
      <summary className="cursor-pointer list-none font-semibold marker:hidden">
        <span className="mr-2 inline-block text-red transition-transform group-open:rotate-90">›</span>
        {q}
      </summary>
      <p className="mt-2 pl-4 text-sm text-muted">{children}</p>
    </details>
  );
}

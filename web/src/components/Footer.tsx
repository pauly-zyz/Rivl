import Link from "next/link";

const LINKS = [
  { href: "/rules", label: "Rules & FAQ" },
  { href: "/fair", label: "Provably fair" },
  { href: "/terms", label: "Terms" },
  { href: "/responsible-gaming", label: "Responsible gaming" },
];

/** Footer dengan peringatan risiko (docs/spec.md 5.4). */
export function Footer() {
  return (
    <footer className="relative border-t border-line/70 bg-bg/80" data-testid="footer">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-red/50 via-transparent to-blue/50" />
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <div>
            <span className="font-display text-3xl font-black leading-none">
              Rivl<span className="text-red">.</span>
            </span>
            <p className="mt-2 text-sm text-muted">Find your rival. Take the pot.</p>
          </div>
          <p className="max-w-2xl rounded-xl border border-line bg-surface/70 p-4 text-sm leading-relaxed text-muted">
            <b className="text-ink">18+ only. Play responsibly.</b> Duels use real funds and you can lose your entire
            stake. Blockchain transactions are final and can&apos;t be reversed. Only play with money you can afford to
            lose. Rivl is not available in all regions, and you are responsible for following the laws where you live.
          </p>
        </div>
        <nav className="flex flex-col gap-2.5 text-sm md:items-end" aria-label="Footer">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="font-semibold text-muted transition-colors hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="mx-auto max-w-6xl px-4 pb-8 text-xs text-faint sm:px-6">
        © Rivl. Smart contracts hold all stakes; Rivl never plays against you.
      </div>
    </footer>
  );
}

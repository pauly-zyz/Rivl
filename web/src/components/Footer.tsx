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
    <footer className="border-t border-line" data-testid="footer">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 text-sm sm:px-6">
        <p className="max-w-3xl text-muted">
          <b className="text-ink">18+ only. Play responsibly.</b> Duels use real funds and you can lose your entire
          stake. Blockchain transactions are final and can&apos;t be reversed. Only play with money you can afford to
          lose. Rivl is not available in all regions, and you are responsible for following the laws where you live.
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Footer">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="font-semibold text-muted hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-faint">© Rivl. Smart contracts hold all stakes; Rivl never plays against you.</p>
      </div>
    </footer>
  );
}

import { Badge, SectionTitle } from "./ui";
import { COMING_SOON } from "@/lib/comingSoon";
import { configResult } from "@/lib/config";

export function ComingSoon() {
  const xUrl = configResult.ok ? configResult.config.xUrl : undefined;

  return (
    <section aria-labelledby="coming-soon">
      <SectionTitle>
        <span id="coming-soon">Coming soon</span>
      </SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {COMING_SOON.map((f) => (
          <article key={f.name} className="flex flex-col rounded-xl border border-dashed border-line-strong bg-surface/50 p-4" data-testid="coming-soon-card">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold">{f.name}</h3>
              <Badge>Soon</Badge>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted">{f.text}</p>
            {xUrl ? (
              <a
                href={xUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex h-9 items-center justify-center rounded-lg border border-line-strong text-sm font-semibold text-ink hover:border-muted"
              >
                Notify me
              </a>
            ) : (
              <span
                aria-disabled
                title="Set NEXT_PUBLIC_X_URL to enable"
                className="mt-4 inline-flex h-9 cursor-not-allowed items-center justify-center rounded-lg border border-line text-sm font-semibold text-faint"
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

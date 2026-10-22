import type { ReactNode } from "react";

/** Penanda konten hukum yang belum tersedia (docs/spec.md 5.2). */
export function LegalPlaceholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-black tracking-tight">{title}</h1>
      <div
        className="rounded-xl border-2 border-dashed border-red bg-red-deep px-5 py-10 text-center"
        data-testid="legal-placeholder"
      >
        <p className="text-lg font-black tracking-wide text-red">TO BE PROVIDED BY LEGAL COUNSEL</p>
        <p className="mt-2 text-sm text-muted">This page is a placeholder. Its final text has not been written yet.</p>
      </div>
      {children}
    </article>
  );
}

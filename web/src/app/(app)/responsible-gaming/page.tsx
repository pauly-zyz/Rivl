import type { Metadata } from "next";
import Link from "next/link";

import { LegalPlaceholder } from "@/components/LegalPlaceholder";

export const metadata: Metadata = { title: "Responsible gaming — Rivl" };

export default function ResponsibleGamingPage() {
  return (
    <LegalPlaceholder title="Responsible gaming">
      <section className="rounded-xl border border-line bg-surface p-5 text-sm">
        <h2 className="font-bold">Tools available now</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>
            <b className="text-ink">Daily stake limit</b> per token, on{" "}
            <Link href="/me#limits" className="text-blue underline">
              My duels
            </Link>
            .
          </li>
          <li>
            <b className="text-ink">Take a break</b> for 24 hours, 7 days or 30 days, which hides creating and joining
            duels.
          </li>
        </ul>
      </section>
    </LegalPlaceholder>
  );
}

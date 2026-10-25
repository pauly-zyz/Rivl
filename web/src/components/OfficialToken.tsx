"use client";

import { useState } from "react";

import { configResult, explorerAddress } from "@/lib/config";

/** Alamat contract token $RIVL resmi, dengan tombol salin dan link explorer. */
export function OfficialToken({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const token = configResult.ok ? configResult.config.rivlToken : undefined;
  if (!token) return null;
  const link = explorerAddress(token);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard diblokir: alamat tetap bisa diseleksi manual */
    }
  };
  return (
    <div className={`rounded-xl border border-line bg-surface/70 p-3 ${className}`} data-testid="official-token">
      <p className="eyebrow text-[10px] text-muted">Official $RIVL token (Robinhood Chain)</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all font-mono text-xs text-ink sm:text-sm">{token}</code>
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-line-strong px-2 py-0.5 text-xs font-semibold text-muted transition-colors hover:text-ink"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-bright hover:underline">
            Explorer ↗
          </a>
        )}
      </div>
      <p className="mt-1 text-[11px] text-faint">Always check this address. Any other &ldquo;RIVL&rdquo; token is not ours.</p>
    </div>
  );
}

"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import type { TxState } from "@/hooks/useTx";
import { explorerTx } from "@/lib/config";
import { shortAddress } from "@/lib/format";

type ButtonVariant = "primary" | "secondary" | "ghost" | "blue";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-red text-white hover:bg-[#f05a5f] disabled:bg-red/40",
  blue: "bg-blue text-white hover:bg-[#6390ff] disabled:bg-blue/40",
  secondary: "bg-raised text-ink border border-line-strong hover:border-muted disabled:text-faint",
  ghost: "text-muted hover:text-ink disabled:text-faint",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const sizes = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-sm", lg: "h-12 px-5 text-base" };
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold tracking-wide transition-colors disabled:cursor-not-allowed ${sizes[size]} ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface ${className}`}>{children}</div>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{children}</h2>
      {aside}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "red" | "blue" | "strong" }) {
  const tones = {
    neutral: "border-line-strong text-muted",
    red: "border-red/50 text-red",
    blue: "border-blue/50 text-blue",
    strong: "border-ink/40 text-ink",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Dialog modal. Di layar kecil tampil sebagai bottom sheet. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 outline-none animate-fade-in sm:max-w-lg sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:text-ink" aria-label="Close">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  const url = explorerTx(hash);
  const text = label ?? shortAddress(hash);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="font-mono text-blue hover:underline">
      {text}
    </a>
  ) : (
    <span className="font-mono text-muted" title={hash}>
      {text}
    </span>
  );
}

/** Status transaksi yang sedang berjalan. */
export function TxNotice({ state }: { state: TxState }) {
  if (state.status === "idle") return null;
  if (state.status === "error") {
    return (
      <p role="alert" className="rounded-lg border border-red/40 bg-red-deep px-3 py-2 text-sm text-ink">
        {state.error}
      </p>
    );
  }
  const text =
    state.status === "wallet"
      ? `${state.label}: confirm in your wallet…`
      : state.status === "pending"
        ? `${state.label}: waiting for confirmation…`
        : `${state.label}: confirmed`;
  return (
    <p className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-sm text-muted" aria-live="polite">
      {state.status !== "success" && <Spinner className="h-3.5 w-3.5" />}
      <span>{text}</span>
      {"hash" in state && <TxLink hash={state.hash} />}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

export function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "font-bold text-ink" : "text-ink"}>{value}</dd>
    </div>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm text-red">{children}</p>;
}

/** Pemberitahuan saat pengguna sedang "Take a break": Create/Join disembunyikan. */
export function BreakNotice({ until }: { until?: number }) {
  return (
    <div className="rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm text-muted" data-testid="break-notice">
      You&apos;re taking a break
      {until ? <> until <b className="text-ink">{new Date(until * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</b></> : null}
      . Creating and joining duels is hidden. Reveals, refunds and claims still work.
    </div>
  );
}

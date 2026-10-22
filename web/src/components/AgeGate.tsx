"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo } from "./Header";
import { Button } from "./ui";
import { browserStore } from "@/lib/storage";

/** Naikkan versi jika Terms berubah supaya pengguna menyetujui ulang. */
export const AGE_GATE_KEY = "rivl:age-gate:v1";
/** Halaman yang tetap bisa dibaca sebelum menyetujui (mis. untuk membaca Terms dari dalam gate). */
const OPEN_PATHS = ["/terms", "/responsible-gaming"];

/** Age gate kunjungan pertama (docs/spec.md 5.4): konfirmasi 18+ dan setuju Terms. */
export function AgeGate() {
  const path = usePathname();
  const [state, setState] = useState<"checking" | "required" | "accepted" | "left">("checking");
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);

  useEffect(() => {
    let accepted = false;
    try {
      accepted = !!JSON.parse(browserStore()?.getItem(AGE_GATE_KEY) ?? "null")?.accepted;
    } catch {
      /* data rusak = belum setuju */
    }
    setState(accepted ? "accepted" : "required");
  }, []);

  useEffect(() => {
    if (state !== "required") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [state]);

  if (state === "checking" || state === "accepted" || OPEN_PATHS.includes(path)) return null;

  function enter() {
    browserStore()?.setItem(AGE_GATE_KEY, JSON.stringify({ accepted: true, at: new Date().toISOString() }));
    setState("accepted");
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/95 p-4 backdrop-blur" role="dialog" aria-modal aria-label="Age verification" data-testid="age-gate">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6">
        <Logo />
        {state === "left" ? (
          <p className="mt-6 text-muted">Rivl is only for adults aged 18 and over. You can close this tab.</p>
        ) : (
          <>
            <h2 className="mt-6 text-xl font-black tracking-tight">Before you enter</h2>
            <p className="mt-2 text-sm text-muted">
              Rivl lets you stake real funds against other players. You can lose your entire stake.
            </p>
            <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#e5484d]" />
              <span>I am 18 years or older, and older than the legal age for this activity where I live.</span>
            </label>
            <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#e5484d]" />
              <span>
                I agree to the{" "}
                <Link href="/terms" className="text-blue underline">
                  Terms
                </Link>{" "}
                and have read the{" "}
                <Link href="/responsible-gaming" className="text-blue underline">
                  Responsible gaming
                </Link>{" "}
                page.
              </span>
            </label>
            <div className="mt-6 flex gap-2">
              <Button className="flex-1" disabled={!adult || !terms} onClick={enter}>
                Enter Rivl
              </Button>
              <Button variant="secondary" onClick={() => setState("left")}>
                I&apos;m under 18
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

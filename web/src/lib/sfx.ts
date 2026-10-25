"use client";

import { useSyncExternalStore } from "react";

/*
 * Efek suara arena, disintesis dengan Web Audio (tanpa file audio).
 * Bisa dimatikan dari header; pilihan disimpan di localStorage per browser.
 * Browser baru mengizinkan suara setelah pengguna berinteraksi (klik/ketuk), jadi konteks audio dibuka saat itu.
 */

const KEY = "rivl:sound:v1";
const listeners = new Set<() => void>();
let ctx: AudioContext | undefined;

function readMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === "off";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(KEY, muted ? "off" : "on");
  } catch {
    /* localStorage diblokir: pilihan berlaku sampai halaman ditutup */
  }
  mutedNow = muted;
  listeners.forEach((l) => l());
}

let mutedNow: boolean | undefined;
const isMuted = () => (mutedNow ??= readMuted());

/** Status suara untuk tombol di header. */
export function useSoundMuted(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isMuted,
    () => false,
  );
}

function audio(): AudioContext | undefined {
  if (typeof window === "undefined" || isMuted()) return undefined;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx.state === "running" ? ctx : undefined;
  } catch {
    return undefined;
  }
}

/** Buka konteks audio pada interaksi pertama, supaya suara berikutnya boleh diputar. */
export function unlockAudioOnInteraction() {
  if (typeof window === "undefined") return;
  const unlock = () => {
    if (!isMuted()) {
      try {
        ctx ??= new AudioContext();
        void ctx.resume().catch(() => {});
      } catch {
        /* tidak didukung */
      }
    }
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

type Note = { f: number; at: number; dur: number; type?: OscillatorType; gain?: number; slideTo?: number };

function play(notes: Note[]) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + 0.02;
  for (const n of notes) {
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = n.type ?? "triangle";
    osc.frequency.setValueAtTime(n.f, t0 + n.at);
    if (n.slideTo) osc.frequency.exponentialRampToValueAtTime(n.slideTo, t0 + n.at + n.dur);
    const peak = n.gain ?? 0.18;
    g.gain.setValueAtTime(0.0001, t0 + n.at);
    g.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
    osc.connect(g).connect(a.destination);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.dur + 0.05);
  }
}

export const sfx = {
  /** Lawan ditemukan: sapuan naik + dua nada tegas. */
  match: () =>
    play([
      { f: 180, slideTo: 720, at: 0, dur: 0.35, type: "sawtooth", gain: 0.08 },
      { f: 392, at: 0.32, dur: 0.18, type: "square", gain: 0.1 },
      { f: 587, at: 0.48, dur: 0.32, type: "square", gain: 0.1 },
    ]),
  /** Hitung mundur 3·2·1. */
  tick: () => play([{ f: 880, at: 0, dur: 0.09, type: "square", gain: 0.09 }]),
  /** Menang: arpeggio naik. */
  win: () =>
    play([
      { f: 523, at: 0, dur: 0.16 },
      { f: 659, at: 0.12, dur: 0.16 },
      { f: 784, at: 0.24, dur: 0.16 },
      { f: 1047, at: 0.36, dur: 0.45, gain: 0.22 },
    ]),
  /** Kalah: dua nada turun. */
  lose: () =>
    play([
      { f: 392, at: 0, dur: 0.25, type: "sine", gain: 0.16 },
      { f: 262, slideTo: 196, at: 0.22, dur: 0.5, type: "sine", gain: 0.16 },
    ]),
  /** Seri atau hasil duel orang lain: satu nada netral. */
  neutral: () => play([{ f: 659, at: 0, dur: 0.25, type: "sine", gain: 0.14 }, { f: 659, at: 0.2, dur: 0.3, type: "sine", gain: 0.1 }]),
};

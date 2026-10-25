"use client";

import { useEffect, useState } from "react";

/*
 * Notifikasi browser untuk pembuat room: "Rival found!" saat ada yang join selagi tab Rivl di latar belakang.
 * Tanpa server push: hanya bekerja selama tab Rivl masih terbuka (boleh di tab lain / jendela lain).
 * Izin diminta hanya saat pengguna menekan tombol, tidak otomatis.
 */

type Permission = "unsupported" | NotificationPermission;

function current(): Permission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function useNotificationPermission() {
  const [perm, setPerm] = useState<Permission>("unsupported");
  useEffect(() => setPerm(current()), []);
  const request = async () => {
    if (current() === "unsupported") return;
    try {
      setPerm(await Notification.requestPermission());
    } catch {
      setPerm(current());
    }
  };
  return { permission: perm, request };
}

let titleTimer: ReturnType<typeof setInterval> | undefined;

/** Kedipkan judul tab sampai pengguna kembali ke tab ini. */
function flashTitle(text: string) {
  if (typeof document === "undefined" || !document.hidden || titleTimer) return;
  const original = document.title;
  let on = false;
  titleTimer = setInterval(() => {
    on = !on;
    document.title = on ? text : original;
  }, 1_000);
  const stop = () => {
    if (document.hidden) return;
    clearInterval(titleTimer);
    titleTimer = undefined;
    document.title = original;
    document.removeEventListener("visibilitychange", stop);
  };
  document.addEventListener("visibilitychange", stop);
}

/** Beri tahu pembuat bahwa room-nya mendapat lawan (hanya jika tab sedang tidak dilihat). */
export function notifyRivalJoined(duel: { id: string; game: string }) {
  if (typeof document === "undefined" || !document.hidden) return;
  const name = duel.game === "Dice" ? "Dice Duel" : duel.game;
  flashTitle(`⚔ Rival found! · ${name} #${duel.id}`);
  if (current() !== "granted") return;
  try {
    const n = new Notification("Rival found! ⚔", {
      body: `Someone joined your ${name} #${duel.id}. Come back to reveal and see who wins.`,
      tag: `rivl-duel-${duel.id}`,
    });
    n.onclick = () => {
      window.focus();
      if (!location.pathname.endsWith(`/duel/${duel.id}`)) location.assign(`/duel/${duel.id}`);
      n.close();
    };
  } catch {
    /* beberapa browser HP hanya mengizinkan notifikasi lewat service worker */
  }
}

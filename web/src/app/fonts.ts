import localFont from "next/font/local";

/*
 * Font di-host sendiri dari paket @fontsource-variable (npm), tanpa Google Fonts.
 * Path relatif terhadap file ini: web/src/app → web/node_modules.
 */

/** Judul: Archivo variabel dengan sumbu lebar (62–125%) untuk huruf expanded yang tegas. */
export const display = localFont({
  src: "../../node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2",
  variable: "--font-archivo",
  weight: "100 900",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});

/** Teks: Inter variabel. */
export const sans = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

/** Angka, alamat, hash: JetBrains Mono variabel. */
export const mono = localFont({
  src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains",
  weight: "100 800",
  display: "swap",
});

export const fontVariables = `${display.variable} ${sans.variable} ${mono.variable}`;

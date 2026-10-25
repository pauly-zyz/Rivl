# Rivl

Platform PvP 1 lawan 1 (Coinflip, Dice Duel, Suit) di Robinhood Chain. Acuan utama: `docs/spec.md`.
Jika ada yang bertentangan dengan spec, tanyakan dulu sebelum mengubah apa pun.

## Aturan penting

- Aturan keamanan contract di `docs/spec.md` bagian 3.6 harus selalu benar. Perubahan logika contract
  dijelaskan dulu dan menunggu persetujuan.
- Jangan mengarang chain ID, RPC, alamat explorer, atau alamat USDG. Pakai `.env` dan
  sebutkan sumber resmi, atau tanyakan.
- Game Coming Soon (spec bagian 1 dan 2.4) hanya kartu di website, jangan dibangun.
- Jangan commit private key atau `.env`. Jangan deploy ke testnet/mainnet tanpa persetujuan.

## Struktur

```
contracts/   Foundry. ABI hasil ekspor di contracts/abi/ (@rivl/contracts/abi)
indexer/     Ponder 0.18. API: indexer/src/api/index.ts
web/         Next.js 16 + wagmi 2 + RainbowKit. Baca web/AGENTS.md (Next 16 berbeda dari versi lama).
scripts/     dev-chain, demo, deploy-env, dev (orkestrator)
docs/        spec.md, technical-status.md (jawaban pertanyaan teknis bagian 8)
```

## Perintah

```bash
git submodule update --init --recursive   # library Foundry
pnpm install
pnpm dev              # Anvil + deploy + indexer (:42069) + web (:3000)
pnpm demo             # (saat pnpm dev jalan) mainkan duel contoh + cocokkan indexer dengan chain
pnpm test:contracts   # forge test
pnpm test:web         # Vitest (termasuk test vector commit Suit)
pnpm e2e              # Playwright di chain lokal (menjalankan pnpm dev jika belum jalan)
pnpm abi              # setelah mengubah contract: build + ekspor ABI
pnpm typecheck
```

Butuh Node >= 22.12, pnpm 10, dan Foundry (`anvil`, `forge`).

## Web

- Status & hasil duel selalu dibaca dari contract (`getDuel`); indexer untuk daftar, feed, riwayat, tx hash.
- Jangan pernah menampilkan hasil sebelum status Settled/Draw di chain (lihat `web/src/components/arena.tsx`).
- Rahasia duel (semua game; Coinflip/Dice memakai move 0): `web/src/lib/suit.ts`. Disimpan di localStorage SEBELUM tx;
  dicari lewat commit. Penerima Coinflip/Dice mengirim seed acak baru (`randomSeed`).
- Teks UI dalam bahasa Inggris.
- Geoblock ada di `web/src/proxy.ts` (Next 16 menamai middleware "proxy"). Halaman blokir memakai root layout
  terpisah di `web/src/app/(blocked)`; semua halaman lain di `web/src/app/(app)`.
- Age gate, batas harian, dan Take a break disimpan di localStorage (`web/src/lib/limits.ts`).
  Take a break hanya menyembunyikan Create/Join; reveal, refund, dan klaim harus tetap bisa dipakai.
- Test e2e memeriksa bahwa setiap halaman bebas error console.
- Daily Spin holder RIVL (spec 5.6): API di `indexer/src/api/rewards/` (data di schema Postgres `rivl_rewards`,
  bukan tabel Ponder), web di `web/src/app/(app)/spin`, `web/src/components/RewardsPanel.tsx`, kosmetik di
  `web/src/lib/cosmetics.ts`. Klaim mingguan lewat contract `RivlRewards`.

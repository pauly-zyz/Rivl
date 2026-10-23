# PvP Arena — Robinhood Chain

Smart contract game PvP 1 lawan 1 dengan taruhan **ETH** atau **USDG**.
Platform tidak pernah melawan pemain: dana kedua pemain dikunci di kontrak,
pemenang mendapat pot dikurangi fee **2,5%**, dan fee masuk ke treasury.

> **Status:** belum diaudit. `forge build` dan `forge test` lulus (lihat `docs/spec.md`).
> Audit pihak ketiga tetap disarankan sebelum menerima uang dalam jumlah besar.

---

## Status fitur

| Fitur | Status |
|---|---|
| Coinflip | ✅ Dibangun |
| Dice Duel | ✅ Dibangun |
| Suit (Gunting-Batu-Kertas) | ✅ Dibangun |
| Battle Royale (2–10 pemain) | 🔜 Coming Soon |
| High Card | 🔜 Coming Soon |
| Mines Duel | 🔜 Coming Soon |
| Arena Memecoin — Jackpot | 🔜 Coming Soon |
| Arena Tebak Arah Harga Saham | 🔜 Coming Soon |
| Kasino (slot, dll.) | 🔜 Coming Soon |
| Referral (bagi hasil fee) | 🔜 Coming Soon |
| Layanan auto-reveal | 🔜 Coming Soon |

---

## Aturan game

Ketiga game memakai **commit-reveal antar pemain**. Tidak ada oracle, VRF, atau operator yang memberi angka acak.

1. Pembuat mengirim `commit = keccak256(abi.encode(chainId, arena, creator, move, salt))`.
   Coinflip/Dice memakai `move = 0` (rahasianya hanya salt); Suit memakai pilihannya (1–3).
2. Penerima bergabung: Suit dengan pilihannya, Coinflip/Dice dengan **seed acak 32 byte** miliknya (bukan nol).
3. Pembuat memanggil `reveal(id, move, salt)`. Kontrak mencocokkan hash, lalu langsung menentukan pemenang.
4. Jika pembuat tidak reveal dalam `revealWindow` (default 1 jam), **penerima menang**
   (`claimRevealTimeout`, bisa dipicu siapa pun). Jadi menahan rahasia saat tahu kalah tidak menguntungkan.

**Coinflip.** Pembuat memilih Kepala (0) atau Ekor (1); penerima otomatis mendapat sisi lawannya.
`randomWord = keccak256(abi.encode(salt, joinerSeed))`, hasil = `randomWord % 2`.

**Dice Duel.** Dari `randomWord` yang sama: pembuat = `uint128(randomWord) % 100 + 1`,
penerima = `(randomWord >> 128) % 100 + 1`. Angka tertinggi menang. Seri → dana dikembalikan, tanpa fee.

**Suit.** 1 = Batu, 2 = Kertas, 3 = Gunting. Kertas > Batu, Gunting > Kertas, Batu > Gunting. Seri → refund tanpa fee.
Pilihan tidak valid di commit → penerima menang.

**Kenapa adil.** Pembuat mengunci salt sebelum seed penerima ada, jadi tidak bisa memilih salt yang menang.
Penerima memilih seed tanpa tahu salt, jadi tidak bisa memilih seed yang menang.

**Batasan yang diketahui.** Seperti Suit, pembuat yang melihat transaksi `join` di mempool bisa mendahuluinya
dengan `cancel` jika hasilnya kalah. Di Robinhood Chain (Arbitrum Orbit) sequencer mengurutkan transaksi
first-come-first-served tanpa mempool publik, jadi ini sulit dilakukan. Cara ini juga hanya membatalkan duel
(dana penerima tidak berpindah), bukan mencuri.

---

## Alur status duel

```
            create* (commit)         join (+ move/seed)
  (None) ─────────────▶ Open ─────────────────────▶ AwaitingReveal ── reveal ──▶ Settled / Draw
                         │                                 │
                         │ cancel (pembuat)                └─ timeout ─▶ Settled (penerima menang)
                         ▼
                     Cancelled
```

Hasil apa pun dikreditkan ke `claimable[pemain][token]`. Pemain menarik dengan `withdraw(token)`.

---

## Jaminan keamanan

- **Owner tidak bisa mengambil dana pemain.** Tidak ada fungsi untuk itu. `rescue()` hanya
  mengambil kelebihan di atas `escrowed + totalClaimable` (misalnya token yang terkirim tidak sengaja).
- **Owner tidak bisa memengaruhi hasil.** Tidak ada sumber randomness yang diatur owner atau operator.
- **Fee dikunci saat duel dibuat**, dan dibatasi maksimal 10% (`MAX_FEE_BPS`).
- **Tidak ada dana yang bisa terjebak.** Duel terbuka bisa dibatalkan pembuat kapan saja;
  reveal yang tidak datang → penerima menang setelah `revealWindow`. Fungsi timeout bisa dipanggil siapa pun.
- **Pause** hanya menghentikan duel baru. Batal, reveal, timeout, dan penarikan tetap berjalan.
- **Pull payment + ReentrancyGuard** pada semua fungsi yang memindahkan dana.
- **Token fee-on-transfer/rebasing ditolak** (pengecekan selisih saldo).
- **Commit terikat** ke chain id, alamat kontrak, dan alamat pembuat, dan tidak bisa dipakai ulang (di game mana pun).

Diuji oleh `test/DuelArena.t.sol`: semua hasil game, seri, timeout, batal, kedaluwarsa, commit/salt/seed salah,
batas taruhan, akses admin, pause, rescue, reentrancy, plus fuzz konservasi dana
(`saldo kontrak == escrowed + totalClaimable` setelah setiap skenario).

---

## Struktur

```
src/
  DuelArena.sol                      kontrak inti (escrow + 3 game, commit-reveal)
test/
  DuelArena.t.sol                    escrow, 3 game, timeout, admin, fuzz konservasi dana
  SuitCommitVectors.t.sol            mencocokkan test-vectors/ dengan computeCommit
  mocks/Mocks.sol
test-vectors/
  suit-commit.json                   input tetap → commit, untuk unit test frontend
abi/                                 hasil script/export-abi.mjs, diimpor sebagai @rivl/contracts/abi
  DuelArena.{json,ts}                `duelArenaAbi` (as const) untuk web, indexer, dan scripts
script/
  Deploy.s.sol
  export-abi.mjs                     membuat ulang isi abi/
```

---

## Setup & test

Butuh [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
cd contracts
git submodule update --init --recursive   # forge-std + OpenZeppelin v5.1.0 (sudah terdaftar di .gitmodules)
forge build
forge test -vvv
```

Setelah mengubah `DuelArena.sol`, buat ulang ABI:

```bash
forge build && node script/export-abi.mjs     # tulis abi/*.{json,ts} (atau: pnpm abi dari root)
node script/export-abi.mjs --check            # untuk CI: gagal jika abi/ usang
```

**Test vector commit.** `test-vectors/suit-commit.json` berisi input tetap (chainId, arena, creator, move, salt)
dan commit yang diharapkan. `test/SuitCommitVectors.t.sol` memastikan nilainya sama dengan
`DuelArena.computeCommit`; unit test frontend wajib menghasilkan commit yang sama persis.

Kontrak memakai API OpenZeppelin v5 (`Ownable(initialOwner)`, `utils/Pausable.sol`, `utils/ReentrancyGuard.sol`).

---

## Deploy

1. Salin `.env.example` ke `.env` dan isi `TREASURY`, `OWNER` (opsional, sebaiknya multisig), `USDG`,
   dan opsional `ETH_MAX_STAKE` / `USDG_MAX_STAKE`.
2. Masukkan private key hanya di shell: `read -s PRIVATE_KEY && export PRIVATE_KEY`.
3. Simulasi, lalu deploy:

```bash
forge script script/Deploy.s.sol --rpc-url robinhood          # simulasi
forge script script/Deploy.s.sol --rpc-url robinhood --broadcast
```

Jika `OWNER` diisi alamat lain (disarankan multisig), owner baru harus memanggil `acceptOwnership()`.

Batas default di script: ETH 0,0005–0,5 per pemain, USDG 1–1.000 per pemain.

---

## Catatan integrasi frontend

**Daftar duel terbuka:** indeks event `DuelCreated`, lalu kurangi yang sudah `DuelJoined` atau `DuelCancelled`.
Detail duel: `getDuel(id)`.

**Taruhan USDG:** pemain harus `approve(arena, jumlah)` terlebih dulu. Untuk ETH, kirim `msg.value` tepat sama dengan jumlah taruhan.

**Commit — hitung di browser**, jangan lewat `computeCommit` via RPC
(itu mengirim pilihan + salt ke penyedia RPC):

```ts
import { encodeAbiParameters, keccak256, toHex } from "viem";

const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
const commit = keccak256(
  encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint8" }, { type: "bytes32" }],
    [BigInt(chainId), arenaAddress, creatorAddress, move /* 0 untuk Coinflip/Dice */, salt]
  )
);
// Simpan { duelId, move, salt } di localStorage SEBELUM mengirim transaksi.
// Tanpa salt, pemain tidak bisa reveal dan akan kalah karena timeout.
```

**Seed penerima (Coinflip/Dice):** `toHex(crypto.getRandomValues(new Uint8Array(32)))`, baru untuk setiap join.

**Tombol "Klaim":** tampilkan `claimable(user, token)` dan panggil `withdraw(token)`.

**Halaman provably fair:** tampilkan commit, seed penerima, salt yang dibuka, dan hitung ulang
`keccak256(abi.encode(salt, seed))` di browser.

---

## Sebelum mainnet

- [x] `forge build` & `forge test` lulus semua
- [ ] Audit kontrak oleh pihak ketiga
- [ ] Owner dan treasury memakai multisig
- [ ] Bug bounty
- [ ] Batas taruhan rendah di minggu-minggu awal
- [ ] Konsultasi hukum (perizinan, yurisdiksi, verifikasi usia)

# PvP Arena — Robinhood Chain

Smart contract game PvP 1 lawan 1 dengan taruhan **ETH** atau **USDG**.
Platform tidak pernah melawan pemain: dana kedua pemain dikunci di kontrak,
pemenang mendapat pot dikurangi fee **2,5%**, dan fee masuk ke treasury.

> **Status:** belum diaudit. `forge build` dan `forge test` lulus (Tahap 1, lihat `docs/spec.md`).
> Audit pihak ketiga tetap wajib sebelum menerima uang sungguhan.

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
| Layanan auto-reveal untuk Suit | 🔜 Coming Soon |

---

## Aturan game

**Coinflip.** Pembuat memilih Kepala (0) atau Ekor (1); penerima otomatis mendapat sisi lawannya.
Hasil dari Chainlink VRF.

**Dice Duel.** Kedua pemain mendapat angka 1–100 dari satu angka acak VRF
(128 bit bawah untuk pembuat, 128 bit atas untuk penerima). Angka tertinggi menang.
Seri → dana dikembalikan, tanpa fee.

**Suit.** Pembuat mengunci pilihannya dalam bentuk hash (commit). Penerima memilih terbuka.
Pembuat lalu membuka pilihannya (reveal) dan kontrak menentukan pemenang.
1 = Batu, 2 = Kertas, 3 = Gunting. Seri → refund tanpa fee.
- Pembuat tidak bisa mengganti pilihan, karena hash tidak akan cocok.
- Jika pembuat tidak reveal dalam `revealWindow` (default 1 jam), **penerima menang**.
  Ini mencegah pembuat kabur saat tahu dirinya kalah.
- Konsekuensinya: pembuat duel Suit harus kembali untuk reveal. Frontend wajib menyimpan salt
  dan mengingatkan pemain. Layanan auto-reveal ada di daftar Coming Soon.

---

## Alur status duel

```
            create*                 join
  (None) ─────────────▶ Open ─────────────────┬──────────────▶ AwaitingRandomness ── VRF ──▶ Settled / Draw
                         │                    │  (Coinflip/Dice)        │
                         │ cancel (pembuat)   │                         └─ timeout ─▶ Refunded
                         ▼                    │
                     Cancelled                └──────────────▶ AwaitingReveal ── reveal ──▶ Settled / Draw
                                                 (Suit)                 │
                                                                        └─ timeout ─▶ Settled (penerima menang)
```

Hasil apa pun dikreditkan ke `claimable[pemain][token]`. Pemain menarik dengan `withdraw(token)`.

---

## Jaminan keamanan

- **Owner tidak bisa mengambil dana pemain.** Tidak ada fungsi untuk itu. `rescue()` hanya
  mengambil kelebihan di atas `escrowed + totalClaimable` (misalnya token yang terkirim tidak sengaja).
- **Fee dikunci saat duel dibuat**, dan dibatasi maksimal 10% (`MAX_FEE_BPS`).
- **Tidak ada dana yang bisa terjebak.** Duel terbuka bisa dibatalkan pembuat kapan saja;
  randomness yang tidak datang → refund setelah `randomnessTimeout`; reveal yang tidak datang →
  penerima menang setelah `revealWindow`. Fungsi timeout bisa dipanggil siapa pun.
- **Pause** hanya menghentikan duel baru. Batal, penyelesaian, dan penarikan tetap berjalan.
- **Pull payment + ReentrancyGuard** pada semua fungsi yang memindahkan dana.
- **Token fee-on-transfer/rebasing ditolak** (pengecekan selisih saldo).
- **Callback randomness tidak pernah revert** untuk request yang tidak dikenal atau sudah selesai.
- **Commit Suit terikat** ke chain id, alamat kontrak, dan alamat pembuat, serta tidak bisa dipakai ulang.

Diuji oleh `test/DuelArena.t.sol`: semua hasil game, seri, timeout, batal, kedaluwarsa,
batas taruhan, akses admin, pause, rescue, reentrancy, plus fuzz konservasi dana
(`saldo kontrak == escrowed + totalClaimable` setelah setiap skenario).

---

## Struktur

```
src/
  DuelArena.sol                      kontrak inti (escrow + 3 game)
  interfaces/IRandomness.sol         antarmuka randomness yang bisa diganti
  randomness/ChainlinkVRFAdapter.sol adaptor Chainlink VRF v2.5 (produksi)
  randomness/DevRandomnessProvider.sol  hasil diatur manual — HANYA test/testnet
test/
  DuelArena.t.sol                    escrow, 3 game, timeout, admin, fuzz konservasi dana
  ChainlinkVRFAdapter.t.sol          adaptor VRF dengan mock coordinator
  SuitCommitVectors.t.sol            mencocokkan test-vectors/ dengan computeCommit
  mocks/Mocks.sol
  mocks/MockVRFCoordinatorV2Plus.sol
test-vectors/
  suit-commit.json                   input tetap → commit Suit, untuk unit test frontend
abi/                                 hasil script/export-abi.mjs, diimpor sebagai @rivl/contracts/abi
  DuelArena.{json,ts}                `duelArenaAbi` (as const) untuk web & indexer
  DevRandomnessProvider.{json,ts}    untuk scripts/auto-fulfill (lokal/testnet)
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

**Test vector Suit.** `test-vectors/suit-commit.json` berisi input tetap (chainId, arena, creator, move, salt)
dan commit yang diharapkan. `test/SuitCommitVectors.t.sol` memastikan nilainya sama dengan
`DuelArena.computeCommit`; unit test frontend wajib menghasilkan commit yang sama persis.

Kontrak memakai API OpenZeppelin v5 (`Ownable(initialOwner)`, `utils/Pausable.sol`, `utils/ReentrancyGuard.sol`).

---

## Deploy

1. Salin `.env.example` ke `.env` dan isi.
2. **Testnet tanpa VRF:** kosongkan `VRF_COORDINATOR`. Script memakai `DevRandomnessProvider`,
   dan kamu menyelesaikan duel secara manual dengan `fulfill(requestId, angka)`.
3. **Dengan Chainlink VRF:** per 22 Okt 2026, Robinhood Chain **belum** ada di daftar
   [VRF v2.5 Supported Networks](https://docs.chain.link/vrf/v2-5/supported-networks). Pastikan VRF v2.5 tersedia untuk Robinhood Chain di halaman
   *supported networks* Chainlink, buat subscription, isi `VRF_*`, deploy, lalu tambahkan alamat
   adapter sebagai consumer di subscription. Jika VRF belum tersedia, mainnet harus menunggu
   atau memakai provider lain yang mengimplementasikan `IRandomnessProvider` (misalnya commit-reveal operator).

```bash
source .env
forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast
```

Jika `OWNER` diisi alamat lain (disarankan multisig), owner baru harus memanggil `acceptOwnership()`.

Batas awal di script: ETH 0,0005–0,5 per pemain, USDG 1–1.000 per pemain.

---

## Catatan integrasi frontend

**Daftar duel terbuka:** indeks event `DuelCreated`, lalu kurangi yang sudah `DuelJoined` atau `DuelCancelled`.
Detail duel: `getDuel(id)`.

**Taruhan USDG:** pemain harus `approve(arena, jumlah)` terlebih dulu. Untuk ETH, kirim `msg.value` tepat sama dengan jumlah taruhan.

**Commit Suit — hitung di browser**, jangan lewat `computeCommit` via RPC
(itu mengirim pilihan + salt ke penyedia RPC):

```ts
import { encodeAbiParameters, keccak256, toHex } from "viem";

const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
const commit = keccak256(
  encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint8" }, { type: "bytes32" }],
    [BigInt(chainId), arenaAddress, creatorAddress, move, salt]
  )
);
// Simpan { duelId, move, salt } di localStorage SEBELUM mengirim transaksi.
// Tanpa salt, pemain tidak bisa reveal dan akan kalah karena timeout.
```

**Tombol "Klaim":** tampilkan `claimable(user, token)` dan panggil `withdraw(token)`.

**Halaman provably fair:** tampilkan `randomWord`, `requestId`, dan link transaksi VRF untuk Coinflip/Dice;
untuk Suit, tampilkan commit dan reveal.

---

## Sebelum mainnet

- [ ] `forge build` & `forge test` lulus semua
- [ ] Verifikasi adaptor VRF terhadap dokumentasi resmi Chainlink, uji di testnet dengan VRF sungguhan
- [ ] Audit kontrak oleh pihak ketiga
- [ ] Owner dan treasury memakai multisig
- [ ] Bug bounty
- [ ] Batas taruhan rendah di minggu-minggu awal
- [ ] Konsultasi hukum (perizinan, yurisdiksi, geoblock, verifikasi usia)

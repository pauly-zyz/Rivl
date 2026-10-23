# Rivl

**Find your rival. Take the pot.** Platform duel 1 lawan 1 di Robinhood Chain: Coinflip, Dice Duel, dan Suit
(batu-gunting-kertas) dengan taruhan ETH atau USDG. Smart contract mengunci kedua taruhan, menentukan pemenang secara
bisa diverifikasi, dan membayar pemenang `2 × taruhan − fee 2,5%`. Rivl tidak pernah menjadi lawan pemain.

> **Status:** belum diaudit. Ketiga game memakai commit-reveal antar pemain (tanpa VRF atau operator), jadi tidak ada
> ketergantungan ke layanan randomness (lihat [docs/spec.md](docs/spec.md) bagian 2.5).

**Deployment mainnet** (Robinhood Chain, chain ID 4663, 23 Okt 2026):

| | |
|---|---|
| DuelArena | `0x8CD728AeF4CC0ff548A95C13cc647FBD70f400b9` (blok 95798376) |
| Treasury | `0x4b08C1DbE28e4e260037299e8cb4B34c7FBe2195` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Batas taruhan awal | ETH 0,0005–0,05 · USDG 1–100 per pemain · fee 2,5% |

| Dokumen | Isi |
|---|---|
| [docs/spec.md](docs/spec.md) | Spesifikasi lengkap (acuan utama) |
| [docs/technical-status.md](docs/technical-status.md) | Jawaban pertanyaan teknis: randomness, USDG, chain ID/RPC, EVM, Ponder |
| [contracts/README.md](contracts/README.md) | Detail contract, jaminan keamanan, integrasi frontend |
| [CLAUDE.md](CLAUDE.md) | Aturan kerja singkat untuk repo ini |

## Isi repo

```
contracts/   Foundry: DuelArena (commit-reveal untuk 3 game), test, ABI (contracts/abi)
indexer/     Ponder 0.18: tabel duel + withdrawal, HTTP API (indexer/src/api/index.ts), GraphQL
web/         Next.js 16 + wagmi 2 + viem + RainbowKit + Tailwind 4
scripts/     dev-chain (Anvil + deploy), demo, deploy-env, dev (orkestrator `pnpm dev`)
docs/        spec dan status teknis
```

---

## 1. Menjalankan lokal

### Prasyarat

- Node.js **22.12+** dan pnpm **10** (`corepack enable`)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`anvil`, `forge`, `cast`)

### Langkah

```bash
git clone --recurse-submodules <url-repo> rivl && cd rivl
# sudah ter-clone tanpa submodule?  git submodule update --init --recursive
pnpm install
cp .env.example .env        # opsional untuk lokal; lihat DEV_EXTRA_ACCOUNTS di bawah
pnpm dev
```

`pnpm dev` menjalankan semuanya dalam satu terminal (Ctrl+C menghentikan semuanya):

| Komponen | Alamat | Keterangan |
|---|---|---|
| Anvil | `http://127.0.0.1:8545`, chain ID 31337 | Dimulai dari nol setiap kali |
| Contract | `deployments/local.json` | DuelArena, MockUSDG (6 desimal) |
| Indexer | `http://localhost:42069` | `/duels/open`, `/stats`, `/graphql`, … |
| Web | `http://localhost:3000` | |

### Bermain dari browser

1. Isi `DEV_EXTRA_ACCOUNTS=<alamat wallet kamu>` di `.env`, lalu jalankan ulang `pnpm dev`. Alamat itu otomatis diberi
   100 ETH dan 10.000 USDG lokal. Tidak perlu mengimpor private key apa pun.
2. Di wallet (mis. MetaMask), tambahkan jaringan: RPC `http://127.0.0.1:8545`, chain ID `31337`, mata uang `ETH`.
3. Buka `http://localhost:3000`, Connect, lalu buat duel. Untuk melawan diri sendiri, pakai dua alamat (dua profil
   browser) dan isi keduanya di `DEV_EXTRA_ACCOUNTS`.

> Karena chain lokal di-reset setiap `pnpm dev`, MetaMask bisa menolak transaksi dengan error *nonce*.
> Perbaiki lewat Settings → Advanced → **Clear activity tab data**.

### Test

| Perintah | Isi |
|---|---|
| `pnpm test:contracts` | Foundry: 54 test (3 game, commit/seed/salt salah, timeout, fee, admin, reentrancy, fuzz, test vector commit) |
| `pnpm test:web` | Vitest: commit = test vector Foundry, randomWord = Solidity, backup/restore, geoblock, batas pribadi |
| `pnpm e2e` | Playwright di chain lokal (menyalakan `pnpm dev` jika belum jalan) |
| `pnpm demo` | Saat `pnpm dev` jalan: memainkan duel lewat script dan mencocokkan setiap query indexer dengan chain |
| `pnpm typecheck` | TypeScript semua paket |

Test e2e memainkan Coinflip ETH dan Dice USDG (dengan approve) sampai reveal, Suit sampai reveal, Suit timeout, cancel, dan claim
dari browser, plus age gate, geoblock, batas pribadi, `/fair`, dan tata letak 375px/desktop tanpa error console.
Playwright memakai dompet uji yang meneruskan transaksi ke akun Anvil (`web/e2e/wallet.ts`).

Setelah mengubah `contracts/src`, jalankan `pnpm abi` untuk memperbarui ABI yang dipakai web dan indexer.

---

## 2. Deploy contract

Langkah yang sama untuk **testnet** (chain ID 46630, `--rpc-url robinhood_testnet`) dan **mainnet** (chain ID 4663,
`--rpc-url robinhood`). Sumber chain ID/RPC/explorer: [docs.robinhood.com/chain/connecting](https://docs.robinhood.com/chain/connecting/).
Tidak ada layanan randomness atau auto-fulfill: hasil Coinflip/Dice berasal dari commit pembuat + seed penerima.

> Contract belum diaudit. Untuk mainnet, mulai dengan batas taruhan kecil (`ETH_MAX_STAKE`, `USDG_MAX_STAKE`) dan
> owner/treasury multisig. Lihat bagian 5.

1. **Siapkan wallet deployer** khusus (bukan wallet utama) dengan sedikit ETH di chain tujuan
   (simulasi deploy memakai ~0,0001 ETH gas).
2. **Isi konfigurasi**, tanpa private key di file:

   ```bash
   cd contracts
   cp .env.example .env
   # isi TREASURY, OWNER (opsional, sebaiknya multisig), USDG (alamat ada di komentar .env.example),
   # dan opsional ETH_MAX_STAKE / USDG_MAX_STAKE
   read -s PRIVATE_KEY && export PRIVATE_KEY      # ketik/tempel private key; tidak tersimpan di file
   ```

3. **Simulasi dulu** (tanpa mengirim transaksi):

   ```bash
   forge script script/Deploy.s.sol --rpc-url robinhood_testnet     # mainnet: --rpc-url robinhood
   ```

4. **Deploy dan verifikasi** di Blockscout:

   ```bash
   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast \
     --verify --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/
   # mainnet: --rpc-url robinhood ... --verifier-url https://robinhoodchain.blockscout.com/api/
   ```

   Script ini men-deploy DuelArena, mengatur fee 2,5%, dan memasang batas taruhan
   (default ETH 0,0005–0,5; USDG 1–1.000 per pemain). Pola URL verifikasi mengikuti contoh resmi
   ([Deploy a Contract](https://docs.robinhood.com/chain/deploy-smart-contracts/)).

5. **Ambil hasilnya** sebagai env siap salin:

   ```bash
   pnpm deploy:env 46630      # mainnet: pnpm deploy:env 4663
   ```

   Script membaca `contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json`, menulis `deployments/<network>.json`,
   dan mencetak env untuk Railway (indexer) dan Vercel (web): alamat `DuelArena`, USDG, dan **nomor blok** deploy
   (`ARENA_START_BLOCK`). Tidak membaca private key.

6. **Jika `OWNER` diisi**, owner baru (multisig) harus memanggil `acceptOwnership()` di DuelArena. Sampai itu terjadi,
   deployer tetap owner.

**Mengubah parameter** setelah deploy (owner): `setTokenConfig`, `setFeeBps` (maks. 10%), `setTimings`,
`setTreasury`, `pause`/`unpause`. Contoh:

```bash
cast send $ARENA "setTokenConfig(address,bool,uint128,uint128)" $USDG true 1000000 100000000 \
  --rpc-url robinhood_testnet --private-key $PRIVATE_KEY
```

---

## 3. Konfigurasi indexer

Indexer membaca `.env` di root. Untuk testnet:

```bash
INDEXER_CHAIN=testnet
ROBINHOOD_TESTNET_RPC=https://…           # sebaiknya RPC berbayar (Alchemy/QuickNode/Chainstack); RPC publik dibatasi
ROBINHOOD_TESTNET_CHAIN_ID=46630
ARENA_ADDRESS=0x…                          # dari langkah deploy
ARENA_START_BLOCK=…                        # blok deploy DuelArena
DATABASE_URL=postgres://user:pass@host:5432/rivl
DATABASE_SCHEMA=rivl_v1                    # nama baru setiap deploy indexer
```

Jalankan:

```bash
pnpm --filter @rivl/indexer start -- --port 42069
```

- Jika chain ID, RPC, atau alamat kosong, indexer berhenti dengan pesan yang menyebut variabel yang kurang.
- `GET /ready` membalas 200 setelah indexer mengejar chain; `GET /status` menunjukkan blok terakhir yang diindeks.
- Endpoint: `/duels/open`, `/duels/:id`, `/duels?ids=…`, `/players/:address/{duels,stats,pending-reveals,withdrawals}`,
  `/results/recent`, `/stats`, `/graphql`, `/sql/*`. Semua bilangan uint dikirim sebagai string.
- Indexer harus bisa diakses dari browser pengguna (web memanggilnya langsung). Taruh di belakang HTTPS.
- Untuk mainnet: `INDEXER_CHAIN=mainnet`, `ROBINHOOD_RPC`, `ROBINHOOD_CHAIN_ID=4663`.

### Hosting di Railway

Konfigurasi ada di `deploy/railway/` (Dockerfile + `indexer.json`). Di satu project Railway:

1. **Postgres**: *New → Database → PostgreSQL*.
2. **Service `indexer`**: *New → GitHub Repo* → repo ini. Di *Settings*: *Config-as-code path* =
   `deploy/railway/indexer.json` (Root Directory biarkan kosong). Isi *Variables* dari blok "Railway: service indexer"
   di output `pnpm deploy:env`. Lalu *Networking → Generate Domain*; URL ini = `NEXT_PUBLIC_INDEXER_URL`.
   Healthcheck memakai `/health`; `/ready` baru 200 setelah indexer mengejar chain.

Setiap kali indexer di-deploy ulang dengan schema atau alamat berbeda, ganti `DATABASE_SCHEMA` (Ponder menolak
memakai schema milik deploy lain).

---

## 4. Deploy web

Web adalah aplikasi Next.js di `web/` dalam pnpm workspace (ABI diimpor dari `@rivl/contracts`).

**Environment** (lihat `.env.example`, bagian WEB):

| Variabel | Contoh testnet |
|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | `46630` |
| `NEXT_PUBLIC_CHAIN_NAME` | `Robinhood Chain Testnet` |
| `NEXT_PUBLIC_RPC_URL` | RPC (sebaiknya berbayar) |
| `NEXT_PUBLIC_EXPLORER_URL` | `https://explorer.testnet.chain.robinhood.com` |
| `NEXT_PUBLIC_ARENA_ADDRESS` | alamat DuelArena |
| `NEXT_PUBLIC_USDG_ADDRESS` | alamat USDG testnet |
| `NEXT_PUBLIC_INDEXER_URL` | URL publik indexer |
| `NEXT_PUBLIC_X_URL` | akun X Rivl (tombol Notify me) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | opsional, untuk MetaMask mobile/WalletConnect |
| `BLOCKED_COUNTRIES` | kosong = semua negara boleh akses (default); isi mis. `XX,YY` hanya jika perlu memblokir |
| `GEO_COUNTRY_HEADER` | `x-vercel-ip-country` di Vercel, `cf-ipcountry` di Cloudflare |

`NEXT_PUBLIC_*` ditanam saat build, jadi **build ulang** setiap kali nilainya berubah. `BLOCKED_COUNTRIES` dan
`GEO_COUNTRY_HEADER` dibaca saat request.

**Vercel:**

1. *Add New → Project* → impor repo ini.
2. *Root Directory* = `web`. Framework terdeteksi sebagai Next.js; install dan build command biarkan default
   (Vercel mendeteksi pnpm workspace dan meng-install dari root).
3. *Environment Variables*: salin blok "Vercel" dari output `pnpm deploy:env`, termasuk
   `ENABLE_EXPERIMENTAL_COREPACK=1` supaya Vercel memakai pnpm versi `packageManager` (10.28).
4. Deploy. Header negara `x-vercel-ip-country` dipasang otomatis oleh Vercel.

Urutan yang paling mudah: contract → indexer di Railway (dapat URL) → web di Vercel.

**Server sendiri:**

```bash
pnpm install
pnpm --filter @rivl/web build
pnpm --filter @rivl/web start -- --port 3000
```

Taruh di belakang CDN yang memasang header negara, dan isi `GEO_COUNTRY_HEADER` dengan nama header tersebut.
Tanpa itu, geoblock bisa dilewati dengan header palsu.

Setelah deploy, cek: halaman utama memuat duel dari indexer, `/fair` bisa memverifikasi duel yang sudah selesai, dan
jika `BLOCKED_COUNTRIES` diisi, akses dengan header negara yang diblokir membalas 451 "Not available in your region".

---

## 5. Sebelum mainnet (docs/spec.md bagian 9)

| Item | Status |
|---|---|
| Kelima tahap selesai dan semua test lulus | ✅ Selesai (lokal) |
| Randomness tidak bergantung pada operator | ✅ Commit-reveal antar pemain (spec 2.5), tanpa VRF/operator |
| Audit contract oleh pihak ketiga | ⬜ Belum |
| Owner dan treasury dipindah ke multisig | ⬜ Belum (script sudah mendukung `OWNER`/`TREASURY` + `acceptOwnership`) |
| Bug bounty aktif | ⬜ Belum |
| Batas taruhan rendah selama minggu-minggu awal | ✅ Default script: ETH 0,0005–0,5, USDG 1–1.000 |
| Konsultasi hukum selesai dan geoblock disesuaikan | ⬜ Belum (Terms & Responsible gaming masih placeholder) |

Tambahan teknis sebelum mainnet:

- Uji USDG sungguhan di testnet (memastikan bukan token fee-on-transfer/rebasing yang akan ditolak contract).
- Uji indexer ke RPC Robinhood Chain sungguhan dan pilih provider RPC berbayar.
- Pembuat duel harus kembali untuk reveal (semua game). Rahasia tersimpan di browser; ingatkan pemain untuk backup.

## Keamanan kunci

- `.env` dan `contracts/.env` ada di `.gitignore`. Jangan commit private key dalam bentuk apa pun.
- Simpan `PRIVATE_KEY` hanya di environment shell saat deploy. Untuk produksi, owner dan treasury adalah multisig;
  deployer hanya dipakai sekali lalu tidak memegang peran apa pun.

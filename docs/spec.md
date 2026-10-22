# Rivl — Spesifikasi Teknis

> Dokumen acuan utama untuk membangun Rivl. Simpan di `docs/spec.md`.
> Jika ada yang bertentangan dengan dokumen ini, tanyakan dulu sebelum mengubah apa pun.

**Versi:** 0.1 · 22 Oktober 2026
**Pemilik:** @choky

---

## 1. Apa itu Rivl

Rivl adalah platform game **PvP 1 lawan 1** di **Robinhood Chain**. Pemain menantang pemain lain dengan taruhan ETH atau USDG. Smart contract mengunci dana kedua pemain, menentukan pemenang secara adil dan bisa diverifikasi, lalu membayar pemenang.

- **Tagline:** Find your rival. Take the pot.
- **Model bisnis:** Rivl mengambil fee 2,5% dari setiap pot. Rivl tidak pernah menjadi lawan pemain, jadi tidak butuh bankroll dan tidak menanggung risiko kalah.
- **Bahasa UI:** Inggris. **Target pengguna:** global, terbuka untuk semua negara.

### Tujuan versi 1

- Tiga game PvP berjalan penuh: Coinflip, Dice Duel, Suit.
- Taruhan ETH dan USDG.
- Setiap hasil bisa diverifikasi pemain.
- Dana pemain tidak bisa diambil admin dan tidak bisa terjebak.

### Bukan tujuan versi 1

Fitur berikut **hanya tampil sebagai kartu "Coming Soon"** di website. Jangan dibangun:

| Fitur | Deskripsi singkat untuk kartu |
| --- | --- |
| High Card | Draw one card each, highest card wins |
| Battle Royale | 2–10 players, random elimination, last one standing takes the pot |
| Mines Duel | Pick your tiles, dodge the mines, outlast your rival |
| Memecoin Jackpot | Pool your tokens, one winner takes all |
| Stock Price Arena | Call the next move of tokenized stocks |
| Casino | Classic casino games |
| Referral | Earn a share of fees from friends you invite |

---

## 2. Game

### 2.1 Coinflip

| | |
| --- | --- |
| Pembuat | Memilih HEADS (0) atau TAILS (1) |
| Penerima | Otomatis mendapat sisi lawannya |
| Hasil | `randomWord % 2` dari VRF |
| Pemenang | Pemilik sisi yang cocok dengan hasil |
| Seri | Tidak mungkin |

### 2.2 Dice Duel

| | |
| --- | --- |
| Pembuat | Tidak memilih apa pun |
| Hasil | Satu `randomWord` dari VRF. Angka pembuat = `uint128(randomWord) % 100 + 1`. Angka penerima = `(randomWord >> 128) % 100 + 1` |
| Pemenang | Angka tertinggi |
| Seri | Angka sama → kedua taruhan dikembalikan, tanpa fee |

### 2.3 Suit (Rock-Paper-Scissors)

| | |
| --- | --- |
| Pilihan | ROCK = 1, PAPER = 2, SCISSORS = 3 |
| Pembuat | Mengirim **commit** (hash pilihan), bukan pilihannya |
| Penerima | Memilih secara terbuka saat bergabung |
| Penentuan | Pembuat me-reveal pilihan + salt. PAPER > ROCK, SCISSORS > PAPER, ROCK > SCISSORS |
| Seri | Pilihan sama → refund tanpa fee |
| Pembuat tidak reveal tepat waktu | Penerima menang |
| Pembuat me-reveal pilihan tidak valid | Penerima menang |
| Randomness | Tidak memakai VRF |

**Rumus commit:**

```
commit = keccak256(abi.encode(uint256 chainId, address arena, address creator, uint8 move, bytes32 salt))
```

- Salt: 32 byte acak, baru untuk setiap duel.
- Commit yang sama tidak bisa dipakai dua kali.
- Commit dihitung di browser, **bukan** lewat RPC (memanggil `computeCommit` via RPC membocorkan pilihan ke penyedia RPC).

### 2.4 Game PvP Coming Soon

Ketiga game berikut adalah game PvP berikutnya. Di versi 1 **hanya tampil sebagai kartu Coming Soon**; aturan di bawah ini dicatat sebagai acuan untuk pengembangan nanti dan **tidak dibangun sekarang**.

| Game | Cara main | Sumber hasil | Kenapa menarik |
| --- | --- | --- | --- |
| High Card | Masing-masing pemain mendapat satu kartu, kartu tertinggi menang | VRF | Familiar bagi pemain kartu |
| Battle Royale | 2–10 pemain menyetor jumlah yang sama, dieliminasi acak satu per satu, pemain terakhir yang bertahan mengambil pot | VRF | Sosial dan viral, cocok ditonton beramai-ramai |
| Mines Duel | Kedua pemain memilih berapa kotak yang akan dibuka di grid berisi ranjau. Ranjau ditempatkan setelah keduanya mengunci pilihan. Yang membuka paling banyak tanpa kena ranjau menang | Commit + VRF | Ada keputusan risiko, jadi pemain merasa punya kendali |

Catatan untuk pengembangan nanti:
- **High Card** dan **Mines Duel** adalah duel 1 lawan 1, jadi bisa ditambahkan ke mesin escrow yang sama dengan Coinflip/Dice/Suit.
- **Battle Royale** butuh logika lobi multi-pemain (menunggu hingga kursi penuh atau batas waktu), sehingga kemungkinan besar butuh contract terpisah.
- **Mines Duel** memakai commit dari kedua pemain sebelum VRF menempatkan ranjau, supaya tidak ada pemain yang bisa menyesuaikan pilihan setelah tahu posisi ranjau.

---

## 3. Smart contract

Kode awal sudah ada di `pvp-arena/` (dari `pvp-arena.zip`) dan dipindahkan ke `contracts/`. Kode itu ditulis tanpa sempat dikompilasi, jadi langkah pertama adalah build dan test.

### 3.1 Daftar contract

| File | Peran |
| --- | --- |
| `src/DuelArena.sol` | Contract inti: escrow, 3 game, fee, klaim, timeout, admin |
| `src/interfaces/IRandomness.sol` | `IRandomnessProvider` dan `IRandomnessConsumer`, supaya sumber randomness bisa diganti |
| `src/randomness/ChainlinkVRFAdapter.sol` | Penghubung ke Chainlink VRF v2.5 untuk produksi |
| `src/randomness/DevRandomnessProvider.sol` | Angka acak diatur manual. **Hanya lokal/testnet** |

### 3.2 Status duel

```
None → Open → AwaitingRandomness → Settled | Draw | Refunded      (Coinflip, Dice)
None → Open → AwaitingReveal     → Settled | Draw                 (Suit)
None → Open → Cancelled
```

| Status | Artinya | Jalan keluar |
| --- | --- | --- |
| Open | Menunggu lawan | `join()` oleh orang lain, atau `cancel()` oleh pembuat kapan saja |
| AwaitingRandomness | Menunggu VRF | VRF datang → selesai. Lewat batas waktu → siapa pun boleh `refundStuckRandomness()` |
| AwaitingReveal | Menunggu pembuat Suit reveal | `revealSuit()` oleh pembuat. Lewat batas waktu → siapa pun boleh `claimRevealTimeout()`, penerima menang |
| Settled | Ada pemenang | Selesai |
| Draw | Seri | Selesai |
| Cancelled | Dibatalkan pembuat | Selesai |
| Refunded | VRF tidak datang | Selesai |

### 3.3 Fungsi publik DuelArena

| Fungsi | Siapa | Keterangan |
| --- | --- | --- |
| `createCoinflip(token, amount, side)` | Siapa pun | `token = address(0)` untuk ETH |
| `createDice(token, amount)` | Siapa pun | |
| `createSuit(token, amount, commit)` | Siapa pun | |
| `join(id, move)` | Siapa pun kecuali pembuat | `move` hanya untuk Suit, isi 0 untuk game lain |
| `revealSuit(id, move, salt)` | Pembuat | Dalam jendela reveal |
| `claimRevealTimeout(id)` | Siapa pun | Setelah jendela reveal lewat |
| `refundStuckRandomness(id)` | Siapa pun | Setelah batas waktu randomness lewat |
| `cancel(id)` | Pembuat | Hanya saat status Open |
| `withdraw(token)` | Siapa pun | Menarik seluruh saldo `claimable` untuk token itu |
| `getDuel(id)` | View | Seluruh data duel |
| `computeCommit(creator, move, salt)` | View | Untuk test; frontend menghitung sendiri |
| `claimable(user, token)` | View | Saldo yang bisa ditarik |

**Admin (owner = multisig):** `setFeeBps`, `setTreasury`, `setRandomnessProvider`, `setTokenConfig`, `setTimings`, `pause`, `unpause`, `rescue`.

### 3.4 Parameter

| Parameter | Nilai awal | Rentang / batas |
| --- | --- | --- |
| Fee | 250 bps (2,5%) dari pot | Maks. 1.000 bps (10%), hard-coded |
| Fee dikunci | Saat duel dibuat | Perubahan fee tidak berlaku untuk duel yang sudah ada |
| Masa duel terbuka | 24 jam | 5 menit – 7 hari |
| Batas waktu randomness | 1 jam | 10 menit – 1 hari |
| Jendela reveal Suit | 1 jam | 5 menit – 1 hari |
| Taruhan ETH | 0,0005 – 0,5 ETH per pemain | Diatur owner |
| Taruhan USDG | 1 – 1.000 USDG per pemain | Diatur owner |
| Fee saat seri / refund / batal | 0 | — |

Pembayaran pemenang = `2 × taruhan − fee`. Contoh: duel 100 USDG vs 100 USDG → pemenang 195 USDG, treasury 5 USDG.

### 3.5 Event

```
DuelCreated(id, creator, game, token, amount, creatorChoice, commit, expiresAt)
DuelJoined(id, joiner, joinerChoice, deadline)
RandomnessRequested(id, requestId)
MoveRevealed(id, move)
DuelSettled(id, winner, token, payout, fee, randomWord)
DuelDrawn(id)
DuelCancelled(id)
DuelRefunded(id)
Withdrawn(user, token, amount)
FeeUpdated, TreasuryUpdated, RandomnessProviderUpdated, TokenConfigUpdated, TimingsUpdated, Rescued
```

### 3.6 Aturan keamanan yang tidak boleh dilanggar

Saat memperbaiki atau mengubah contract, semua poin ini harus tetap benar. Jika sebuah perubahan melanggar salah satunya, berhenti dan tanyakan dulu.

1. Tidak ada fungsi yang membuat owner bisa mengambil dana pemain. `rescue()` hanya boleh mengambil kelebihan di atas `escrowed + totalClaimable`.
2. Semua hasil dibayar dengan pola pull (`claimable` + `withdraw`), bukan dikirim langsung.
3. Semua fungsi yang memindahkan dana memakai `nonReentrant`.
4. Setiap status menunggu punya batas waktu dan jalan keluar yang bisa dipicu siapa pun.
5. Fee dikunci saat duel dibuat dan tidak bisa melebihi 10%.
6. Pause hanya menghentikan `create*` dan `join`. Batal, reveal, timeout, refund, dan withdraw tetap jalan.
7. `fulfillRandomness` tidak pernah revert untuk request yang tidak dikenal atau sudah selesai.
8. Token fee-on-transfer atau rebasing ditolak.
9. Randomness tidak boleh berasal dari blockhash, timestamp, atau data blok lain.
10. `DevRandomnessProvider` tidak boleh dipakai di mainnet.
11. Contract tidak upgradeable.

---

## 4. Indexer

**Pilihan:** Ponder (pastikan mendukung Robinhood Chain; alternatif Envio).

### 4.1 Tabel

**duels**

| Kolom | Sumber |
| --- | --- |
| id, game, token, amount, creator, creatorChoice, commit, createdAt, expiresAt | `DuelCreated` |
| joiner, joinerChoice, joinedAt, deadline | `DuelJoined` |
| requestId | `RandomnessRequested` |
| revealedMove | `MoveRevealed` |
| status, winner, payout, fee, randomWord, settledAt | `DuelSettled` / `DuelDrawn` / `DuelCancelled` / `DuelRefunded` |
| txHash per tahap | Semua event |

**withdrawals:** user, token, amount, txHash, timestamp.

### 4.2 Query yang dibutuhkan

- Duel terbuka: status Open dan belum kedaluwarsa; filter game, token, rentang nominal; urut terbaru atau nominal terbesar.
- Detail satu duel.
- Riwayat duel per alamat + statistik (menang, kalah, seri, volume).
- Duel Suit milik alamat tertentu yang menunggu reveal.
- 20 duel terakhir yang selesai (feed Live results).
- Statistik global: volume per token, jumlah duel, total fee.

---

## 5. Website

### 5.1 Stack

Next.js (App Router), TypeScript, Tailwind, wagmi v2, viem, RainbowKit, TanStack Query. Robinhood Chain didefinisikan sebagai custom chain viem dari variabel `.env`.

### 5.2 Halaman

**`/` — Lobby**
- Hero: logo Rivl, tagline, tombol **Create duel**.
- Daftar duel terbuka (kartu): game, token, nominal, pembuat (alamat disingkat), sisa waktu, tombol **Join**. Filter game/token/nominal.
- Feed **Live results**.
- Bagian **Coming Soon** berisi kartu dari tabel di bagian 1. Setiap kartu punya tombol **Notify me** ke akun X Rivl (URL dari `.env`).

**Modal Create duel**
1. Pilih game.
2. Pilih token. Tampilkan saldo dan batas min/maks dari `tokenConfig`.
3. Isi nominal.
4. Pilih sisi (Coinflip) atau move (Suit).
5. Ringkasan: taruhan, potensi menang (`2 × taruhan − fee`), fee.
6. USDG: cek allowance → `approve` jika perlu → create.

**`/duel/[id]` — Detail duel**
- Status, kedua pemain, nominal, hitung mundur yang relevan.
- Animasi: koin berputar (Coinflip), dua dadu (Dice), tangan suit (Suit). Animasi menunggu berjalan sampai hasil ada di chain, lalu berhenti di hasil sebenarnya. **Jangan pernah menampilkan hasil sebelum terkonfirmasi di chain.**
- Tombol sesuai status dan peran: Join, Cancel, Reveal, Claim timeout, Refund.
- Link transaksi ke explorer. Tombol salin link untuk menantang teman.

**`/me` — Duel saya**
- Saldo klaim per token + tombol **Claim**.
- Duel Suit yang menunggu reveal dari saya, paling atas dan mencolok.
- Riwayat dan statistik pribadi.
- Batas pribadi: batas taruhan harian dan **Take a break** (menyembunyikan Create/Join selama periode yang dipilih). Disimpan di browser.

**`/fair` — Provably fair**
- Penjelasan VRF dan commit-reveal.
- Alat verifikasi: masukkan ID duel → tampilkan `randomWord`, `requestId`, perhitungan hasil langkah demi langkah, dan link transaksi. Untuk Suit: commit, move, salt (setelah reveal), dan hasil hash.

**`/rules`** — Aturan setiap game, fee, batas waktu, FAQ.

**`/terms` dan `/responsible-gaming`** — Placeholder yang jelas ditandai "TO BE PROVIDED BY LEGAL COUNSEL".

### 5.3 Penanganan Suit di browser (kritis)

Jika salt hilang, pemain tidak bisa reveal dan kalah karena timeout. Karena itu:

1. Buat salt dengan `crypto.getRandomValues(new Uint8Array(32))`.
2. Hitung commit dengan viem (`encodeAbiParameters` + `keccak256`) sesuai rumus di bagian 2.3.
3. Simpan `{ chainId, arena, move, salt, commit }` di localStorage **sebelum** mengirim transaksi.
4. Setelah transaksi terkonfirmasi, tambahkan `duelId` dari event `DuelCreated`.
5. Sediakan **Back up** (unduh JSON) dan **Restore** (unggah JSON) di `/me`.
6. Setiap kali aplikasi dibuka, cek duel Suit pengguna yang sudah diterima lawan dan tampilkan banner **"You need to reveal"** dengan hitung mundur.
7. Unit test: hasil commit dari frontend harus sama persis dengan test vector dari Foundry.

### 5.4 Kepatuhan

- **Age gate** saat kunjungan pertama: konfirmasi 18+ dan setuju Terms.
- **Geoblock:** middleware Next.js membaca header negara dari hosting/CDN dan menampilkan halaman "Not available in your region" untuk negara di `BLOCKED_COUNTRIES`. Default kosong: semua negara boleh akses. Daftar bisa diisi lewat env kapan saja tanpa ubah kode.
- Footer berisi peringatan risiko dan link ke Terms dan Responsible gaming.

### 5.5 Gaya visual

- Gelap, tegas, kompetitif. Terasa seperti arena, bukan kasino murahan.
- Hindari koin emas berhamburan, lampu kedip, dan warna mencolok berlebihan.
- Logo teks "Rivl" sederhana.
- Mobile-first; harus rapi di lebar 375px.
- Jangan memakai nama, logo, maskot, atau warna merek Robinhood, termasuk "Hood" dan "Cash Cat".

---

## 6. Struktur repo

```
rivl/
├── CLAUDE.md
├── docs/
│   └── spec.md            ← dokumen ini
├── contracts/             ← Foundry (isi pvp-arena/)
├── indexer/               ← Ponder
├── web/                   ← Next.js
├── scripts/
│   ├── dev-chain          ← Anvil + deploy contract + mock USDG + mint ke akun test
│   └── auto-fulfill       ← otomatis memenuhi request DevRandomnessProvider
├── package.json           ← pnpm workspaces
└── .env.example
```

Satu perintah `pnpm dev` menjalankan chain lokal, auto-fulfill, indexer, dan web.

### Variabel lingkungan

| Variabel | Dipakai di | Keterangan |
| --- | --- | --- |
| `PRIVATE_KEY` | contracts | Jangan pernah di-commit |
| `TREASURY`, `OWNER` | contracts | Multisig untuk produksi |
| `USDG` | contracts, web | Alamat resmi USDG |
| `VRF_COORDINATOR`, `VRF_KEY_HASH`, `VRF_SUB_ID`, `VRF_CONFIRMATIONS`, `VRF_CALLBACK_GAS`, `VRF_NATIVE_PAYMENT` | contracts | Kosongkan `VRF_COORDINATOR` untuk testnet dengan DevRandomnessProvider |
| `ROBINHOOD_RPC`, `ROBINHOOD_TESTNET_RPC` | semua | RPC resmi |
| `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_EXPLORER_URL` | web | |
| `NEXT_PUBLIC_ARENA_ADDRESS`, `NEXT_PUBLIC_USDG_ADDRESS` | web | |
| `NEXT_PUBLIC_INDEXER_URL` | web | |
| `NEXT_PUBLIC_X_URL` | web | Untuk tombol Notify me |
| `BLOCKED_COUNTRIES` | web | Kode negara dipisah koma (kosong = tidak ada yang diblokir) |

**Jangan mengarang** chain ID, RPC, alamat explorer, alamat USDG, atau parameter VRF. Ambil dari dokumentasi resmi dan sebutkan sumbernya, atau tanyakan.

---

## 7. Tahap pengerjaan

Kerjakan berurutan. Di akhir setiap tahap: jalankan semua test, laporkan hasil singkat, dan tunggu persetujuan sebelum lanjut.

| Tahap | Isi | Selesai jika |
| --- | --- | --- |
| 1 | **Contract** — build, perbaiki, verifikasi adaptor VRF, test adaptor dengan mock coordinator, test vector commit Suit, ekspor ABI | `forge test` lulus semua; semua aturan di 3.6 tetap benar |
| 2 | **Lingkungan lokal & indexer** — `scripts/dev-chain`, `scripts/auto-fulfill`, `pnpm dev`, indexer Ponder sesuai bagian 4 | Satu perintah menjalankan semuanya; semua query indexer mengembalikan data benar dari chain lokal |
| 3 | **Web inti** — Lobby, modal Create, Detail duel, `/me`, penanganan Suit di browser | Ketiga game bisa dimainkan dari browser di chain lokal; unit test commit lulus |
| 4 | **Web pelengkap** — `/fair`, `/rules`, legal, kartu Coming Soon, age gate, geoblock, batas pribadi | Semua halaman ada dan rapi di 375px dan desktop |
| 5 | **Uji end-to-end & siap testnet** — Playwright, `.env.example` lengkap, panduan deploy | Semua tes E2E lulus; panduan bisa diikuti dari nol. **Jangan deploy sebelum disetujui** |

### 7.1 Prompt untuk Claude Code

Simpan dokumen ini sebagai `docs/spec.md`, letakkan isi `pvp-arena/` (dari `pvp-arena.zip`) di `contracts/`, lalu jalankan prompt berikut satu per satu. Kirim prompt berikutnya hanya setelah tahap sebelumnya selesai dan kamu setujui.

**Tahap 1 — Contract**

```
Baca docs/spec.md secara lengkap, lalu baca contracts/README.md dan seluruh isi contracts/src.
Jelaskan rencanamu dalam beberapa poin sebelum menulis kode.

Kerjakan Tahap 1:
1. Jalankan forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0,
   lalu forge build dan forge test -vvv. Perbaiki sampai semua lulus.
   Semua aturan di bagian 3.6 harus tetap benar. Jika perbaikan butuh mengubah logika
   (bukan sekadar sintaks), jelaskan dulu dan tunggu persetujuan saya.
2. Verifikasi ChainlinkVRFAdapter terhadap antarmuka resmi Chainlink VRF v2.5
   (struct request, tag extra args, signature rawFulfillRandomWords). Sesuaikan jika berbeda.
   Cari tahu apakah VRF v2.5 tersedia di Robinhood Chain dan laporkan beserta sumbernya.
3. Tambahkan test ChainlinkVRFAdapter dengan mock coordinator: request diteruskan,
   hanya coordinator yang bisa fulfill, callback yang gagal tidak membuat revert.
4. Buat test vector commit Suit (input tetap → hasil commit) untuk dipakai test frontend.
5. Ekspor ABI DuelArena ke JSON dan file TypeScript "as const" untuk web dan indexer.

Jangan buat game Coming Soon (bagian 1 dan 2.4). Laporkan hasil test di akhir.
```

**Tahap 2 — Lingkungan lokal & indexer**

```
Baca ulang docs/spec.md bagian 4 dan 6. Kerjakan Tahap 2:
1. Siapkan monorepo pnpm workspaces sesuai struktur di bagian 6.
2. Buat scripts/dev-chain: jalankan Anvil, deploy DuelArena + DevRandomnessProvider +
   mock USDG (6 desimal), atur tokenConfig, mint ETH dan USDG ke beberapa akun test.
3. Buat scripts/auto-fulfill: dengarkan request dari DevRandomnessProvider dan penuhi
   otomatis dengan angka acak, supaya Coinflip dan Dice bisa dicoba seperti produksi.
4. Buat indexer Ponder di indexer/ dengan tabel dan semua query di bagian 4.
   Konfigurasi chain dari .env (lokal, testnet, mainnet).
5. Buat satu perintah pnpm dev yang menjalankan chain lokal, auto-fulfill, dan indexer
   (web menyusul di Tahap 3).

Jangan mengarang chain ID, RPC, atau alamat. Pakai variabel .env dan tanyakan jika tidak yakin.
Buktikan semuanya jalan dengan memainkan satu duel tiap game lewat skrip,
lalu tunjukkan hasilnya dari query indexer.
```

**Tahap 3 — Web inti**

```
Baca ulang docs/spec.md bagian 5. Kerjakan Tahap 3 di web/:
1. Next.js App Router + TypeScript + Tailwind + wagmi v2 + viem + RainbowKit + TanStack Query.
   Definisikan Robinhood Chain sebagai custom chain dari .env.
2. Halaman Lobby (/), modal Create duel, Detail duel (/duel/[id]), dan Duel saya (/me)
   sesuai bagian 5.2, termasuk alur approve USDG.
3. Penanganan Suit di browser persis seperti bagian 5.3, termasuk backup/restore dan
   banner "You need to reveal".
4. Animasi hasil hanya berhenti di hasil yang sudah terkonfirmasi di chain.
5. Unit test Vitest: commit dari frontend sama persis dengan test vector Tahap 1.
6. Ikuti gaya visual di bagian 5.5. Gunakan skill frontend-design jika tersedia.
7. Tambahkan web ke perintah pnpm dev.

Teks UI dalam bahasa Inggris. Buktikan ketiga game bisa dimainkan dari browser di chain lokal.
```

**Tahap 4 — Web pelengkap**

```
Baca ulang docs/spec.md bagian 1, 2.4, 5.2, 5.4, dan 5.5. Kerjakan Tahap 4:
1. Halaman /fair dengan alat verifikasi per ID duel.
2. Halaman /rules (aturan, fee, batas waktu, FAQ), /terms, dan /responsible-gaming
   dengan placeholder "TO BE PROVIDED BY LEGAL COUNSEL".
3. Bagian Coming Soon di Lobby: kartu untuk semua fitur di tabel bagian 1
   (High Card, Battle Royale, Mines Duel, Memecoin Jackpot, Stock Price Arena, Casino, Referral)
   dengan teks dari tabel itu dan tombol "Notify me" ke NEXT_PUBLIC_X_URL.
   Hanya kartu, jangan bangun logika game-nya.
4. Age gate 18+, geoblock lewat middleware dengan BLOCKED_COUNTRIES, dan footer peringatan risiko.
5. Batas pribadi di /me: batas taruhan harian dan "Take a break".
6. Pastikan semua halaman rapi di lebar 375px dan desktop, tanpa error di console.
```

**Tahap 5 — Uji end-to-end & siap testnet**

```
Baca ulang docs/spec.md bagian 6, 7, 8, dan 9. Kerjakan Tahap 5:
1. Tes Playwright di chain lokal: Coinflip ETH, Dice USDG (dengan approve), Suit sampai reveal,
   Suit timeout, cancel duel, dan claim. Perbaiki bug yang ditemukan.
2. Lengkapi .env.example untuk contracts, indexer, dan web sesuai tabel di bagian 6.
3. Tulis README.md di root: cara menjalankan lokal, deploy contract ke testnet,
   konfigurasi indexer, dan deploy web.
4. Buat daftar ringkas jawaban atau status untuk pertanyaan teknis di bagian 8.

JANGAN deploy apa pun ke testnet atau mainnet. Jangan menulis private key ke file yang di-commit.
Akhiri dengan laporan: apa yang sudah dibangun, keputusan penting, dan hal yang masih
perlu saya putuskan.
```

---

## 8. Pertanyaan terbuka

### Teknis

- [ ] Apakah Chainlink VRF v2.5 tersedia di Robinhood Chain (mainnet dan testnet), dan berapa biaya per request?
- [ ] Alamat resmi USDG di Robinhood Chain dan jumlah desimalnya.
- [ ] Chain ID, RPC, dan explorer resmi mainnet dan testnet.
- [ ] Apakah Robinhood Chain mendukung `evm_version` cancun, atau tetap shanghai?
- [ ] Apakah Ponder mendukung Robinhood Chain?

Jika VRF belum tersedia, Suit tetap bisa diluncurkan karena tidak membutuhkan VRF. Coinflip dan Dice menunggu VRF atau provider lain yang mengimplementasikan `IRandomnessProvider`.

### Hukum

- [ ] Status hukum game PvP dengan taruhan di yurisdiksi target, termasuk risiko bagi pemilik/pengembang yang berdomisili di Indonesia.
- [ ] Entitas dan lisensi (misalnya Curaçao, Anjouan, Malta, Isle of Man), biaya dan syaratnya.
- [ ] Daftar negara yang wajib di-geoblock, dan kebutuhan verifikasi usia/KYC.
- [ ] Isi Terms dan Responsible gaming.

---

## 9. Sebelum mainnet

- [ ] Kelima tahap selesai dan semua test lulus.
- [ ] Adaptor VRF diuji di testnet dengan VRF sungguhan.
- [ ] Audit contract oleh pihak ketiga.
- [ ] Owner dan treasury dipindah ke multisig.
- [ ] Bug bounty aktif.
- [ ] Batas taruhan rendah selama minggu-minggu awal.
- [ ] Konsultasi hukum selesai dan geoblock disesuaikan.

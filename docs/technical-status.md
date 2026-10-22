# Status pertanyaan teknis (docs/spec.md bagian 8)

Diperbarui 22 Oktober 2026. Sumber dicek lewat pencarian terbatas ke domain resmi; halaman
`docs.robinhood.com` tidak bisa dibuka langsung dari lingkungan build, jadi **cek ulang nilai di bawah
di halaman resminya sebelum deploy**.

| # | Pertanyaan | Status | Jawaban singkat |
|---|---|---|---|
| 1 | Chainlink VRF v2.5 di Robinhood Chain, biaya per request | ❌ Belum tersedia | Tidak ada di daftar jaringan VRF v2.5. Biaya belum bisa dihitung. |
| 2 | Alamat resmi USDG dan desimal | ✅ Ditemukan | Mainnet `0x5fc5…d168`, testnet `0x7E95…802F`, 6 desimal. |
| 3 | Chain ID, RPC, explorer resmi | ✅ Ditemukan | Mainnet 4663, testnet 46630 (detail di bawah). |
| 4 | `evm_version` cancun atau shanghai | 🟡 Kemungkinan besar cancun | Arbitrum Nitro dengan ArbOS jauh di atas 20; tetap pakai shanghai sampai diuji. |
| 5 | Ponder mendukung Robinhood Chain | 🟡 Kemungkinan besar ya | Ponder mendukung chain EVM apa pun lewat JSON-RPC; belum diuji ke RPC sungguhan. |

---

## 1. Chainlink VRF v2.5

**Status: belum tersedia.**

- Daftar resmi [VRF v2.5 Supported Networks](https://docs.chain.link/vrf/v2-5/supported-networks) hanya memuat
  Arbitrum, Avalanche, BASE, BNB Chain, Ethereum, OP, Polygon, Ronin, dan Soneium. Dicek dari source halaman
  tersebut di repo `smartcontractkit/documentation` (commit `76864fb`, 21 Okt 2026).
- Robinhood Chain sudah memakai Chainlink untuk CCIP, Data Streams, dan Data Feeds, tetapi VRF tidak disebut
  ([berita kemitraan](https://internationalfinance.com/brokerage/robinhood-chain-adopts-chainlink-as-its-cross-chain-oracle-infrastructure/)).
- Biaya per request belum bisa dihitung. Di jaringan yang didukung, biayanya = gas callback × harga gas + premium
  Chainlink. Settle DuelArena lewat VRF memakai ~116k gas (dari `test/ChainlinkVRFAdapter.t.sol`).

**Dampak (sesuai spec):** Suit bisa diluncurkan tanpa VRF. Coinflip dan Dice harus menunggu VRF atau provider lain
yang mengimplementasikan `IRandomnessProvider`. DevRandomnessProvider hanya untuk testnet.

**Yang perlu diputuskan:** tunggu VRF, minta Chainlink menambahkan Robinhood Chain, atau pakai provider lain
(mis. randomness dari jaringan lain lewat CCIP, atau oracle VRF pihak ketiga). Semuanya perlu dinilai keamanannya.

## 2. USDG

**Status: ditemukan.**

| Jaringan | Alamat | Sumber |
|---|---|---|
| Mainnet | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | [Paxos: USDG on Main Networks](https://docs.paxos.com/guides/stablecoin/usdg/mainnet), [Robinhood Chain Token Contracts](https://docs.robinhood.com/chain/contracts/) |
| Testnet | `0x7E955252E15c84f5768B83c41a71F9eba181802F` | [Paxos: USDG on Test Networks](https://docs.paxos.com/guides/stablecoin/usdg/testnet) |

- **Desimal: 6** (ditampilkan explorer token). Aplikasi tidak bergantung pada angka ini: script deploy dan web
  membaca `decimals()` dari contract token.
- Hati-hati dengan alamat lain milik Paxos di Robinhood Chain: `0x0d54…28d1` adalah kontrak OFT (bridge) dan
  `0xdf5F…25D4` adalah supply control. Keduanya **bukan** token.
- Belum dicek: apakah USDG punya fee-on-transfer atau rebasing. DuelArena menolak token seperti itu secara otomatis
  (cek selisih saldo), jadi kalau ada, `create*` akan revert dengan `UnsupportedToken`. Uji di testnet.

## 3. Chain ID, RPC, explorer

**Status: ditemukan.** Sumber: [Connecting to Robinhood Chain](https://docs.robinhood.com/chain/connecting/),
[Deploy a Contract](https://docs.robinhood.com/chain/deploy-smart-contracts/).

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC publik | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` (Blockscout) | `https://explorer.testnet.chain.robinhood.com` |
| Gas | ETH | ETH |

- RPC publik dibatasi rate-nya dan tidak dijamin uptime-nya. Untuk indexer dan web produksi pakai provider berbayar;
  dokumentasi merekomendasikan Alchemy (`https://robinhood-mainnet.g.alchemy.com/v2/<KEY>`), juga mendukung
  Chainstack dan QuickNode.
- Verifikasi contract: `forge verify-contract --verifier blockscout --verifier-url <explorer>/api/`
  (contoh resmi untuk mainnet: `https://robinhoodchain.blockscout.com/api/`).

Nilai-nilai ini sudah dimasukkan ke `.env.example` dan `contracts/.env.example` beserta sumbernya.

## 4. `evm_version`: cancun atau shanghai

**Status: kemungkinan besar cancun didukung; repo tetap memakai shanghai sampai diuji.**

- Robinhood Chain adalah chain Arbitrum yang menjalankan Arbitrum Nitro
  ([Robinhood Chain support](https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/)).
  L2BEAT melaporkan versinya ArbOS 61 ([L2BEAT](https://l2beat.com/layer2s/projects/robinhood)).
- Opcode Cancun (TSTORE/TLOAD dari EIP-1153 dan MCOPY dari EIP-5656) masuk di **ArbOS 20 "Atlas"**
  ([Arbitrum docs](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/arbos20)). Opcode beacon root
  (EIP-4788) tidak didukung dan akan revert.
- Kesimpulan: ArbOS 61 > 20, jadi target `cancun` hampir pasti aman. Ini **kesimpulan**, bukan pernyataan resmi
  Robinhood.
- DuelArena tidak butuh opcode Cancun (OpenZeppelin `ReentrancyGuard` biasa, bukan versi transient), jadi tetap
  `shanghai` tidak ada kerugiannya. Naikkan ke `cancun` hanya jika ingin `ReentrancyGuardTransient` untuk hemat gas,
  dan uji dulu di testnet.

## 5. Ponder di Robinhood Chain

**Status: kemungkinan besar didukung; belum diuji ke RPC sungguhan.**

- Ponder bekerja dengan chain EVM apa pun: cukup chain ID dan URL RPC
  ([ponder.config.ts](https://ponder.sh/docs/api-reference/config)). Robinhood Chain adalah chain Arbitrum standar
  dengan `eth_getLogs` biasa.
- Indexer di repo ini sudah mendukung `INDEXER_CHAIN=testnet|mainnet` (chain ID dan RPC dari `.env`). Uji pertama
  yang perlu dilakukan setelah deploy testnet: jalankan indexer ke RPC testnet dan cek semua endpoint.
- Catatan: RPC publik dibatasi rate-nya; Ponder akan butuh RPC berbayar. Jika ada masalah batas `eth_getLogs`,
  set `ethGetLogsBlockRange` di `indexer/ponder.config.ts`.
- Alternatif: Envio menulis panduan khusus Robinhood Chain
  ([Envio](https://docs.envio.dev/blog/index-robinhood-chain-data)).

---

## Pertanyaan hukum (bagian 8)

Belum dijawab; di luar cakupan teknis. Placeholder di `/terms` dan `/responsible-gaming` masih bertuliskan
"TO BE PROVIDED BY LEGAL COUNSEL", dan `BLOCKED_COUNTRIES` masih default spec (`ID,US`).

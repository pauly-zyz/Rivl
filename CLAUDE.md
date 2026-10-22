# Rivl

Platform PvP 1 lawan 1 (Coinflip, Dice Duel, Suit) di Robinhood Chain. Acuan utama: `docs/spec.md`.
Jika ada yang bertentangan dengan spec, tanyakan dulu sebelum mengubah apa pun.

## Aturan penting

- Aturan keamanan contract di `docs/spec.md` bagian 3.6 harus selalu benar. Perubahan logika contract
  dijelaskan dulu dan menunggu persetujuan.
- Jangan mengarang chain ID, RPC, alamat explorer, alamat USDG, atau parameter VRF. Pakai `.env` dan
  sebutkan sumber resmi, atau tanyakan.
- Game Coming Soon (spec bagian 1 dan 2.4) hanya kartu di website, jangan dibangun.
- Jangan commit private key atau `.env`. Jangan deploy ke testnet/mainnet tanpa persetujuan.

## Struktur

```
contracts/   Foundry. ABI hasil ekspor di contracts/abi/ (@rivl/contracts/abi)
indexer/     Ponder 0.18. API: indexer/src/api/index.ts
scripts/     dev-chain, auto-fulfill, demo, dev (orkestrator)
docs/        spec.md
```

## Perintah

```bash
git submodule update --init --recursive   # library Foundry
pnpm install
pnpm dev              # Anvil + deploy + auto-fulfill + indexer (http://localhost:42069)
pnpm demo             # (saat pnpm dev jalan) mainkan duel contoh + cocokkan indexer dengan chain
pnpm test:contracts   # forge test
pnpm abi              # setelah mengubah contract: build + ekspor ABI
pnpm typecheck
```

Butuh Node >= 22.12, pnpm 10, dan Foundry (`anvil`, `forge`).

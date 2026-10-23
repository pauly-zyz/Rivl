/**
 * `pnpm dev` — chain lokal + indexer + web dalam satu perintah.
 *
 *   1. scripts/dev-chain     Anvil + deploy + isi akun test → deployments/local.json
 *   2. indexer (Ponder)      INDEXER_CHAIN=local, http://localhost:INDEXER_PORT
 *   3. web (Next.js)         http://localhost:WEB_PORT, NEXT_PUBLIC_* diisi dari deployments/local.json
 *
 * Ctrl+C menghentikan semuanya. Chain dimulai dari nol setiap kali, jadi database indexer juga direset.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { startDevChain } from "./dev-chain/index.ts";
import { INDEXER_DIR, REPO_ROOT, envInt, envString, loadRootEnv } from "./lib/env.ts";
import { logger, pipeLines, type LogTag } from "./lib/log.ts";

const log = logger("dev");

function startChild(tag: LogTag, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn("pnpm", args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeLines(child.stdout!, tag);
  pipeLines(child.stderr!, tag, console.error);
  return child;
}

async function main(): Promise<void> {
  loadRootEnv();
  const indexerPort = envInt("INDEXER_PORT", 42069);
  const webPort = envInt("WEB_PORT", 3000);
  const indexerUrl = `http://localhost:${indexerPort}`;

  const chain = await startDevChain();
  const d = chain.deployment;

  // Chain baru → data indexer lama tidak berlaku lagi.
  rmSync(join(INDEXER_DIR, ".ponder"), { recursive: true, force: true });
  const children: Record<string, ChildProcess> = {
    indexer: startChild(
      "indexer",
      ["--filter", "@rivl/indexer", "exec", "ponder", "dev", "--disable-ui", "--port", String(indexerPort)],
      { INDEXER_CHAIN: "local" },
    ),
    web: startChild("web", ["--filter", "@rivl/web", "exec", "next", "dev", "--port", String(webPort)], {
      // Nilai lokal menimpa .env root (next.config tidak menimpa variabel yang sudah di-set).
      NEXT_PUBLIC_CHAIN_ID: String(d.chainId),
      NEXT_PUBLIC_CHAIN_NAME: "Local (Anvil)",
      NEXT_PUBLIC_RPC_URL: d.rpcUrl,
      NEXT_PUBLIC_EXPLORER_URL: "",
      NEXT_PUBLIC_ARENA_ADDRESS: d.contracts.arena,
      NEXT_PUBLIC_USDG_ADDRESS: d.contracts.usdg,
      NEXT_PUBLIC_INDEXER_URL: indexerUrl,
      NEXT_PUBLIC_X_URL: envString("NEXT_PUBLIC_X_URL") ?? "",
    }),
  };

  let shuttingDown = false;
  const shutdown = (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const c of Object.values(children)) c.kill("SIGTERM");
    chain.stop();
    setTimeout(() => process.exit(code), 500);
  };
  for (const [name, child] of Object.entries(children)) {
    child.on("exit", (code) => {
      if (!shuttingDown) {
        log.error(`${name} berhenti (code ${code})`);
        shutdown(1);
      }
    });
  }
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => shutdown(0));

  log.info("──────────────────────────────────────────────────────────");
  log.info(`Web        http://localhost:${webPort}`);
  log.info(`Indexer    ${indexerUrl}  (/duels/open, /stats, /graphql, …)`);
  log.info(`RPC        ${d.rpcUrl}  (chain ID ${d.chainId})`);
  log.info(`DuelArena  ${d.contracts.arena}`);
  log.info(`USDG mock  ${d.contracts.usdg}`);
  log.info("Wallet: tambahkan jaringan RPC di atas, impor akun test Anvil (mnemonic default Anvil),");
  log.info("        atau isi DEV_EXTRA_ACCOUNTS di .env dengan alamat wallet kamu.");
  log.info("Main duel contoh tanpa browser: pnpm demo   ·   Ctrl+C untuk berhenti");
  log.info("──────────────────────────────────────────────────────────");
}

main().catch((err: unknown) => {
  log.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

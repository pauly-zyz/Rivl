/**
 * scripts/dev-chain — chain lokal untuk development.
 *
 * 1. forge build
 * 2. Jalankan Anvil (chain ID 31337, default Anvil)
 * 3. Deploy MockUSDG (6 desimal) + DuelArena
 * 4. Atur tokenConfig (batas taruhan sesuai docs/spec.md bagian 3.4)
 * 5. Isi ETH dan USDG ke akun test
 * 6. Tulis alamat ke deployments/local.json
 *
 * Tidak ada private key: transaksi dikirim dari akun Anvil yang sudah unlocked (eth_sendTransaction).
 * Jalankan sendiri: `pnpm dev:chain`, atau lewat `pnpm dev`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseEther,
  parseUnits,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";

import { CONTRACTS_DIR, DEV_DIR, envInt, envString, findFoundryBin, loadRootEnv } from "../lib/env.ts";
import { LOCAL_DEPLOYMENT_FILE, writeLocalDeployment, type LocalDeployment } from "../lib/deployments.ts";
import { logger } from "../lib/log.ts";

const log = logger("chain");

/** Chain ID default Anvil. */
const LOCAL_CHAIN_ID = foundry.id; // 31337
const FEE_BPS = 250;
const USDG_DECIMALS = 6;
const ETH_PER_ACCOUNT = parseEther("100");
const USDG_PER_ACCOUNT = parseUnits("10000", USDG_DECIMALS);
const PLAYER_COUNT = 5;

// docs/spec.md bagian 3.4
const ETH_MIN_STAKE = parseEther("0.0005");
const ETH_MAX_STAKE = parseEther("0.5");
const USDG_MIN_STAKE = parseUnits("1", USDG_DECIMALS);
const USDG_MAX_STAKE = parseUnits("1000", USDG_DECIMALS);

const mockUsdgAbi = parseAbi(["function mint(address to, uint256 amount)"]);

type Artifact = { abi: Abi; bytecode: { object: Hex } };

function readArtifact(source: string, name: string): Artifact {
  const file = join(CONTRACTS_DIR, "out", source, `${name}.json`);
  if (!existsSync(file)) throw new Error(`Artefak ${file} tidak ada. forge build gagal?`);
  return JSON.parse(readFileSync(file, "utf8")) as Artifact;
}

function forgeBuild(): void {
  if (!existsSync(join(CONTRACTS_DIR, "lib", "forge-std", "src"))) {
    throw new Error("Library Foundry belum ada. Jalankan: git submodule update --init --recursive");
  }
  log.info("forge build ...");
  const res = spawnSync(findFoundryBin("forge"), ["build"], { cwd: CONTRACTS_DIR, encoding: "utf8" });
  if (res.status !== 0) {
    process.stderr.write(res.stdout + res.stderr);
    throw new Error("forge build gagal");
  }
}

async function rpcAlive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function parseExtraAccounts(): Address[] {
  const raw = envString("DEV_EXTRA_ACCOUNTS");
  if (!raw) return [];
  return raw.split(",").map((s) => {
    const a = s.trim();
    if (!isAddress(a)) throw new Error(`DEV_EXTRA_ACCOUNTS berisi alamat tidak valid: "${a}"`);
    return getAddress(a);
  });
}

export type DevChain = {
  deployment: LocalDeployment;
  stop: () => void;
};

export async function startDevChain(): Promise<DevChain> {
  loadRootEnv();
  const port = envInt("ANVIL_PORT", 8545);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const extraAccounts = parseExtraAccounts();

  forgeBuild();

  if (await rpcAlive(rpcUrl)) {
    throw new Error(`Port ${port} sudah dipakai (Anvil lain masih jalan?). Hentikan dulu atau ubah ANVIL_PORT.`);
  }

  mkdirSync(DEV_DIR, { recursive: true });
  const anvilLog = join(DEV_DIR, "anvil.log");
  const anvil: ChildProcess = spawn(
    findFoundryBin("anvil"),
    ["--port", String(port), "--chain-id", String(LOCAL_CHAIN_ID)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const out = createWriteStream(anvilLog);
  anvil.stdout?.pipe(out);
  anvil.stderr?.pipe(out);

  let stopped = false;
  const stop = () => {
    if (!stopped) {
      stopped = true;
      anvil.kill("SIGTERM");
    }
  };
  anvil.on("exit", (code) => {
    if (!stopped) {
      log.error(`Anvil berhenti (code ${code}). Lihat ${anvilLog}`);
      process.exitCode = 1;
    }
  });

  try {
    for (let i = 0; !(await rpcAlive(rpcUrl)); i++) {
      if (i > 100) throw new Error(`Anvil tidak merespons di ${rpcUrl}. Lihat ${anvilLog}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    log.info(`Anvil jalan di ${rpcUrl} (chain ID ${LOCAL_CHAIN_ID}), log: ${anvilLog}`);

    const deployment = await deploy(rpcUrl, extraAccounts);
    writeLocalDeployment(deployment);
    log.info(`Alamat ditulis ke ${LOCAL_DEPLOYMENT_FILE}`);
    return { deployment, stop };
  } catch (err) {
    stop();
    throw err;
  }
}

async function deploy(rpcUrl: string, extraAccounts: Address[]): Promise<LocalDeployment> {
  const chain = { ...foundry, rpcUrls: { default: { http: [rpcUrl] } } };
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ chain, transport: http(rpcUrl) });
  const testClient = createTestClient({ chain, mode: "anvil", transport: http(rpcUrl) });

  const accounts = await wallet.getAddresses();
  if (accounts.length < PLAYER_COUNT + 2) throw new Error("Anvil harus punya minimal 7 akun unlocked");
  const owner = accounts[0]!;
  const treasury = accounts[accounts.length - 1]!;
  const players = accounts.slice(1, 1 + PLAYER_COUNT);
  const testAccounts = [...players, ...extraAccounts.filter((a) => !players.includes(a))];

  async function deployContract(source: string, name: string, args: readonly unknown[] = []) {
    const { abi, bytecode } = readArtifact(source, name);
    const hash = await wallet.deployContract({ abi, bytecode: bytecode.object, args, account: owner });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Deploy ${name} gagal`);
    const address = getAddress(receipt.contractAddress);
    log.info(`${name.padEnd(22)} ${address}`);
    return { address, blockNumber: receipt.blockNumber, abi };
  }

  async function send(address: Address, abi: Abi, functionName: string, args: readonly unknown[], from = owner) {
    const hash = await wallet.writeContract({ address, abi, functionName, args, account: from });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} gagal`);
  }

  const usdg = await deployContract("Mocks.sol", "MockUSDG");
  const arena = await deployContract("DuelArena.sol", "DuelArena", [owner, treasury, FEE_BPS]);

  await send(arena.address, arena.abi, "setTokenConfig", ["0x0000000000000000000000000000000000000000", true, ETH_MIN_STAKE, ETH_MAX_STAKE]);
  await send(arena.address, arena.abi, "setTokenConfig", [usdg.address, true, USDG_MIN_STAKE, USDG_MAX_STAKE]);
  log.info("tokenConfig: ETH 0,0005–0,5 · USDG 1–1.000 per pemain · fee 2,5%");

  for (const account of testAccounts) {
    await testClient.setBalance({ address: account, value: ETH_PER_ACCOUNT });
    await send(usdg.address, mockUsdgAbi, "mint", [account, USDG_PER_ACCOUNT]);
  }
  log.info(`${testAccounts.length} akun test diisi 100 ETH + 10.000 USDG:`);
  testAccounts.forEach((a, i) => log.info(`  ${i < players.length ? `#${i + 1}` : "extra"} ${a}`));
  log.info(`owner ${owner} · treasury ${treasury}`);

  return {
    chainId: LOCAL_CHAIN_ID,
    rpcUrl,
    startBlock: Number(usdg.blockNumber),
    deployedAt: new Date().toISOString(),
    owner,
    treasury,
    contracts: { arena: arena.address, usdg: usdg.address },
    usdgDecimals: USDG_DECIMALS,
    testAccounts,
  };
}

// Dijalankan langsung: `pnpm dev:chain` — chain tetap hidup sampai Ctrl+C.
if (import.meta.url === `file://${process.argv[1]}`) {
  startDevChain()
    .then(({ stop }) => {
      log.info("Chain lokal siap. Ctrl+C untuk berhenti.");
      for (const sig of ["SIGINT", "SIGTERM"] as const) {
        process.on(sig, () => {
          stop();
          process.exit(0);
        });
      }
    })
    .catch((err: unknown) => {
      log.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

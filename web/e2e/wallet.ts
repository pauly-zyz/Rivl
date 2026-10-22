import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Browser, type Page } from "@playwright/test";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { duelArenaAbi } from "@rivl/contracts/abi";

/** deployments/local.json dari scripts/dev-chain. */
export type LocalDeployment = {
  chainId: number;
  rpcUrl: string;
  contracts: { arena: Address; usdg: Address; devRandomness: Address };
  testAccounts: Address[];
};

export function deployment(): LocalDeployment {
  return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "deployments", "local.json"), "utf8"));
}

export function chainClient(d = deployment()) {
  const chain = defineChain({
    id: d.chainId,
    name: "Local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [d.rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(d.rpcUrl) });
}

export async function getDuel(id: bigint) {
  const d = deployment();
  return chainClient(d).readContract({ address: d.contracts.arena, abi: duelArenaAbi, functionName: "getDuel", args: [id] });
}

/**
 * Dompet uji (HANYA untuk test): provider EIP-1193 + EIP-6963 di halaman yang meneruskan
 * setiap request ke Anvil. Akun Anvil sudah unlocked, jadi eth_sendTransaction langsung ditandatangani node.
 */
function installTestWallet(args: { account: string; rpcUrl: string; chainId: number }) {
  const { account, rpcUrl, chainId } = args;
  const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  let nextId = 0;

  async function rpc(method: string, params: unknown[] = []) {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params }),
    });
    const json = await res.json();
    if (json.error) {
      const err = new Error(json.error.message) as Error & { code?: number; data?: unknown };
      err.code = json.error.code;
      err.data = json.error.data;
      throw err;
    }
    return json.result;
  }

  // Seperti wallet sungguhan: akun baru terlihat setelah pengguna menyetujui koneksi (diingat per origin).
  const PERMISSION_KEY = "rivl-test-wallet:connected";
  const connected = () => localStorage.getItem(PERMISSION_KEY) === account;

  const provider = {
    isRivlTestWallet: true,
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case "eth_requestAccounts":
          localStorage.setItem(PERMISSION_KEY, account);
          return [account];
        case "eth_accounts":
          return connected() ? [account] : [];
        case "eth_chainId":
          return `0x${chainId.toString(16)}`;
        case "net_version":
          return String(chainId);
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;
        case "wallet_revokePermissions":
          localStorage.removeItem(PERMISSION_KEY);
          return null;
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          return [{ parentCapability: "eth_accounts" }];
        case "eth_sendTransaction": {
          const [tx] = (params ?? []) as Record<string, unknown>[];
          return rpc("eth_sendTransaction", [{ ...tx, from: account }]);
        }
        default:
          return rpc(method, params);
      }
    },
    on(event: string, fn: (...a: unknown[]) => void) {
      (listeners[event] ??= []).push(fn);
      return provider;
    },
    removeListener(event: string, fn: (...a: unknown[]) => void) {
      listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
      return provider;
    },
  };

  (window as unknown as { ethereum: unknown }).ethereum = provider;
  const info = {
    uuid: "4d1b9c3e-0f5a-4c5e-9a43-7d2b6a1f0c11",
    name: "Rivl Test Wallet",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23e5484d'/%3E%3C/svg%3E",
    rdns: "dev.rivl.testwallet",
  };
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}

/** Error console browser yang terkumpul selama test (semua halaman, dilaporkan di akhir). */
export const consoleErrors: string[] = [];
const errorsByPage = new WeakMap<Page, string[]>();

const createdPages: Page[] = [];

/** Halaman yang dibuat sejak pemanggilan terakhir (untuk diperiksa dan ditutup setelah tiap test). */
export function takeCreatedPages(): Page[] {
  return createdPages.splice(0);
}

/** Error console milik satu halaman saja (halaman dari test lain bisa masih berjalan di latar). */
export function pageErrors(page: Page): string[] {
  return errorsByPage.get(page) ?? [];
}

/** Browser context baru dengan dompet uji untuk satu akun Anvil. */
export async function playerPage(
  browser: Browser,
  account: Address,
  viewport?: { width: number; height: number },
  opts: { ageGate?: "accepted" | "show"; headers?: Record<string, string> } = {},
) {
  const d = deployment();
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  if (opts.headers) {
    // Header negara hanya untuk request ke web (seperti CDN), bukan ke RPC atau indexer.
    const web = new URL(process.env.WEB_URL ?? "http://localhost:3000").origin;
    await context.route(`${web}/**`, (route) => route.continue({ headers: { ...route.request().headers(), ...opts.headers } }));
  }
  await context.addInitScript(installTestWallet, { account, rpcUrl: d.rpcUrl, chainId: d.chainId });
  if (opts.ageGate !== "show") {
    // Test lain tidak menguji age gate; anggap pengguna sudah menyetujuinya.
    await context.addInitScript(() =>
      localStorage.setItem("rivl:age-gate:v1", JSON.stringify({ accepted: true, at: "test" })),
    );
  }
  // Clipboard untuk tombol "Copy link".
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  createdPages.push(page);
  const record = (msg: string) => {
    errors.push(msg);
    consoleErrors.push(msg);
  };
  page.on("console", (m) => {
    // Chrome selalu mencatat dokumen non-2xx; 451 adalah status geoblock yang disengaja.
    if (m.type() === "error" && !m.text().includes("status of 451")) record(`${page.url()} — ${m.text()}`);
  });
  page.on("pageerror", (e) => record(`${page.url()} — ${e.message}`));
  page.on("response", (r) => {
    // 451 = geoblock yang memang diuji.
    if (r.status() >= 400 && r.status() !== 451) record(`${page.url()} — HTTP ${r.status()} ${r.url()}`);
  });
  return page;
}

/** Hubungkan dompet uji lewat modal RainbowKit. */
export async function connect(page: Page) {
  await page.getByRole("button", { name: "Connect", exact: true }).first().click();
  await page.getByRole("dialog").getByText("Rivl Test Wallet").click();
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
}

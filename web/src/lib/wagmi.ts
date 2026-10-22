"use client";

import { connectorsForWallets, type WalletList } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";

import type { AppConfig } from "./config";

export function createWagmiConfig(cfg: AppConfig) {
  const appName = "Rivl";
  const projectId = cfg.walletConnectProjectId;

  // MetaMask (mobile) dan WalletConnect butuh project ID WalletConnect. Tanpa itu, hanya wallet browser.
  const wallets: WalletList = [
    {
      groupName: "Wallets",
      wallets: projectId
        ? [injectedWallet, metaMaskWallet, rabbyWallet, coinbaseWallet, walletConnectWallet]
        : [injectedWallet, rabbyWallet, coinbaseWallet],
    },
  ];

  return createConfig({
    chains: [cfg.chain],
    connectors: connectorsForWallets(wallets, { appName, projectId: projectId ?? "unused" }),
    transports: { [cfg.chain.id]: http(cfg.rpcUrl) },
    ssr: true,
  });
}

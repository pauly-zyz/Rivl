"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { appConfig, configResult } from "@/lib/config";
import { createWagmiConfig } from "@/lib/wagmi";

/** RainbowKit mengikuti identitas Rivl: aksen merah, font Inter, sudut membulat. */
const rivlTheme = (() => {
  const t = darkTheme({ accentColor: "#e5484d", borderRadius: "large", overlayBlur: "small" });
  t.fonts.body = "var(--font-inter), ui-sans-serif, system-ui, sans-serif";
  t.colors.modalBackground = "#101216";
  t.colors.modalBorder = "#23272f";
  t.colors.connectButtonBackground = "#171a20";
  t.colors.connectButtonInnerBackground = "#101216";
  return t;
})();

export function Providers({ children }: { children: ReactNode }) {
  if (!configResult.ok) return <ConfigMissing missing={configResult.missing} />;
  return <ConfiguredProviders>{children}</ConfiguredProviders>;
}

function ConfiguredProviders({ children }: { children: ReactNode }) {
  const [wagmiConfig] = useState(() => createWagmiConfig(appConfig()));
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 1_000 } } }));

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={rivlTheme}
          modalSize="compact"
          appInfo={{ appName: "Rivl" }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function ConfigMissing({ missing }: { missing: string[] }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="font-display text-2xl font-black">Rivl is not configured</h1>
      <p className="mt-3 text-muted">Set these variables in the root .env file (see .env.example), then restart:</p>
      <ul className="mt-4 space-y-1 font-mono text-sm text-red">
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted">
        For local development, run <code className="text-ink">pnpm dev</code> from the repository root.
      </p>
    </main>
  );
}

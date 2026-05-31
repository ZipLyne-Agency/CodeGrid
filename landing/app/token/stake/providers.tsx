"use client";

/**
 * Wallet + query providers, scoped to the /token/stake route only. Keeping the
 * web3 stack here (rather than in the root layout) means the marketing pages
 * never pay the wagmi/viem bundle cost — Next code-splits this client island.
 */
import {ReactNode, useState} from "react";
import {WagmiProvider, createConfig, http} from "wagmi";
import {coinbaseWallet, walletConnect} from "wagmi/connectors";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {GRID_VIEM_CHAIN} from "@/lib/vegrid";

// PUBLIC WalletConnect/Reown projectId (safe to ship in the client bundle).
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
// WalletConnect's provider reads localStorage at init, which throws during SSR
// (and is extra noisy under Node's experimental localStorage). Attach it on the
// client only — connectors are not part of wagmi's serialized SSR state, so the
// server/client connector lists can differ safely.
const enableWalletConnect = Boolean(wcProjectId) && typeof window !== "undefined";

const config = createConfig({
  chains: [GRID_VIEM_CHAIN],
  // Three connection rails:
  //  1. Browser extensions — discovered automatically via EIP-6963
  //     (`multiInjectedProviderDiscovery`, on by default): MetaMask, Rabby,
  //     Brave, Frame, OKX, Uniswap Extension, Phantom… each branded w/ icon.
  //     We deliberately DON'T register a bare `injected()` connector — it adds
  //     a second generic "Injected" button that just opens `window.ethereum`
  //     (usually MetaMask), the duplicate that was showing up.
  //  2. Coinbase — its own SDK connector (works with no extension via Smart
  //     Wallet). wagmi dedupes the EIP-6963 Coinbase announcement against it
  //     by `rdns`.
  //  3. WalletConnect — the universal rail: QR + mobile deep-links for Uniswap
  //     Wallet, Rainbow, Trust, MetaMask Mobile, Phantom, Zerion, Ledger… 600+.
  //     Added only when the projectId is present so builds never break without it.
  connectors: [
    coinbaseWallet({appName: "CodeGrid", preference: "all"}),
    ...(enableWalletConnect
      ? [
          walletConnect({
            projectId: wcProjectId!,
            showQrModal: true,
            metadata: {
              name: "CodeGrid",
              description: "Stake $GRID to unlock CodeGrid Pro",
              // Use the real serving origin (this connector is client-only, so
              // window is defined): matches the Reown allowlist in prod, and
              // avoids the dev "metadata.url differs" warning on localhost.
              url: window.location.origin,
              icons: ["https://www.codegrid.app/icon-512.png"],
            },
          }),
        ]
      : []),
  ],
  transports: {
    [GRID_VIEM_CHAIN.id]: http(
      process.env.NEXT_PUBLIC_BASE_RPC_URL || GRID_VIEM_CHAIN.rpcUrls.default.http[0],
    ),
  },
  ssr: true,
});

export function StakeProviders({children}: {children: ReactNode}) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

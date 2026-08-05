import type { ChainId } from "./types";

export interface ChainConfig {
  id: ChainId;
  name: string;
  badge: string;
  addressStyle: "evm" | "sol";
  adapter: "moralis" | "solana" | "blockscout" | "tamsa";
  /** Moralis chain 파라미터 (EVM 전용) */
  moralisChain?: string;
  /** 데모용 기본 토큰 (키 없이 동작하는 체인 위주) */
  demoToken?: { address: string; label: string };
}

export const CHAINS: Record<ChainId, ChainConfig> = {
  eth: {
    id: "eth",
    name: "Ethereum",
    badge: "EVM",
    addressStyle: "evm",
    adapter: "moralis",
    moralisChain: "eth",
    demoToken: {
      address: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
      label: "LINK",
    },
  },
  bnb: {
    id: "bnb",
    name: "BNB Chain",
    badge: "EVM",
    addressStyle: "evm",
    adapter: "moralis",
    moralisChain: "bsc",
    demoToken: {
      address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      label: "ETH (Peg)",
    },
  },
  sol: {
    id: "sol",
    name: "Solana",
    badge: "SVM",
    addressStyle: "sol",
    adapter: "solana",
    demoToken: {
      address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      label: "JUP",
    },
  },
  rhc: {
    id: "rhc",
    name: "Robinhood Chain",
    badge: "EVM L2",
    addressStyle: "evm",
    adapter: "blockscout",
    demoToken: {
      address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      label: "USDG",
    },
  },
  xph: {
    id: "xph",
    name: "Xphere",
    badge: "EVM",
    addressStyle: "evm",
    adapter: "tamsa",
    demoToken: {
      address: "0x80252c2d06bbd85699c555fc3633d5b8ee67c9ad",
      label: "XEF",
    },
  },
};

export const CHAIN_ORDER: ChainId[] = ["eth", "bnb", "sol", "rhc", "xph"];

export function isChainId(v: string): v is ChainId {
  return Object.hasOwn(CHAINS, v);
}

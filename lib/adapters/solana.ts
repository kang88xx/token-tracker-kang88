import { AdapterError, type HolderRow, type HoldersResult } from "../types";
import { fetchJson } from "../util";

/**
 * Solana 어댑터.
 * - BIRDEYE_API_KEY가 있으면: Birdeye v3 holder API로 상위 100 (owner 지갑 기준)
 * - 없으면: 공개 RPC getTokenLargestAccounts로 상위 20 토큰계정 → owner 해석 (키 불필요)
 * 메타데이터·가격은 Jupiter lite API (키 불필요).
 */
const JUP_TOKEN = "https://lite-api.jup.ag/tokens/v1/token";
const JUP_PRICE = "https://lite-api.jup.ag/price/v3";
const BIRDEYE = "https://public-api.birdeye.so/defi/v3/token/holder";

/**
 * RPC 우선순위: SOLANA_RPC_URL(직접 지정) → Helius(무료 키) → 공개 mainnet-beta.
 * 공개 mainnet-beta는 getTokenLargestAccounts를 강하게 스로틀링하므로
 * 키 없는 경로는 best-effort이고, 429 시 무료 Helius 키 발급을 안내한다.
 */
function rpcUrl(): { url: string; keyless: boolean } {
  if (process.env.SOLANA_RPC_URL) return { url: process.env.SOLANA_RPC_URL, keyless: false };
  if (process.env.HELIUS_API_KEY) {
    return {
      url: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
      keyless: false,
    };
  }
  return { url: "https://api.mainnet-beta.solana.com", keyless: true };
}

interface RpcResp<T> {
  result?: T;
  error?: { code: number; message: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const { url, keyless } = rpcUrl();
  const attempts = keyless ? 3 : 1;
  for (let i = 0; i < attempts; i++) {
    const { status, body } = await fetchJson<RpcResp<T>>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const rpc429 = body?.error?.code === 429;
    if (status === 429 || rpc429) {
      if (i < attempts - 1) {
        await sleep(1200 * (i + 1));
        continue;
      }
      throw new AdapterError(
        "RATE_LIMITED",
        keyless
          ? "Solana 공개 RPC 한도 초과 — 무료 Helius 키(https://helius.dev)를 .env.local의 HELIUS_API_KEY에 넣으면 안정적으로 조회됩니다."
          : "Solana RPC 한도 초과 — 잠시 후 다시 시도해주세요.",
      );
    }
    if (body?.error) {
      const msg = body.error.message || "";
      if (/could not find|invalid/i.test(msg)) {
        throw new AdapterError("TOKEN_NOT_FOUND", "Solana에서 해당 민트 주소를 찾지 못했습니다.");
      }
      throw new AdapterError("UPSTREAM_ERROR", `Solana RPC 오류: ${msg}`);
    }
    if (!body?.result) throw new AdapterError("UPSTREAM_ERROR", "Solana RPC 응답이 비어 있습니다.");
    return body.result;
  }
  throw new AdapterError("UPSTREAM_ERROR", "Solana RPC 재시도 실패");
}

interface JupToken {
  name?: string;
  symbol?: string;
  decimals?: number;
}

async function jupMeta(mint: string): Promise<JupToken | null> {
  const { status, body } = await fetchJson<JupToken>(`${JUP_TOKEN}/${mint}`);
  return status === 200 && body ? body : null;
}

/** Helius DAS getAsset — Jupiter 목록에 없는 토큰도 온체인 메타데이터를 준다 */
async function dasMeta(mint: string): Promise<JupToken | null> {
  const { url } = rpcUrl();
  if (!url.includes("helius")) return null;
  try {
    const { status, body } = await fetchJson<{
      result?: { content?: { metadata?: { name?: string; symbol?: string } } };
    }>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: mint } }),
      timeoutMs: 8000,
    });
    const m = status === 200 ? body?.result?.content?.metadata : undefined;
    return m?.name || m?.symbol ? { name: m.name, symbol: m.symbol } : null;
  } catch {
    return null;
  }
}

async function jupPrice(mint: string): Promise<{ usd: number | null; change24h: number | null }> {
  const { status, body } = await fetchJson<Record<string, { usdPrice?: number; priceChange24h?: number }>>(
    `${JUP_PRICE}?ids=${mint}`,
  );
  const row = status === 200 ? body?.[mint] : undefined;
  return {
    usd: row?.usdPrice ?? null,
    change24h: row?.priceChange24h ?? null,
  };
}

interface BirdeyeHolder {
  owner: string;
  ui_amount: number;
  amount: string;
}

async function birdeyeTop100(mint: string, apiKey: string): Promise<BirdeyeHolder[]> {
  const { status, body } = await fetchJson<{ success?: boolean; data?: { items?: BirdeyeHolder[] } }>(
    `${BIRDEYE}?address=${mint}&offset=0&limit=100`,
    { headers: { "X-API-KEY": apiKey, accept: "application/json", "x-chain": "solana" } },
  );
  if (status === 429) throw new AdapterError("RATE_LIMITED", "Birdeye 호출 한도 초과");
  if (status === 401 || status === 403) {
    throw new AdapterError("UPSTREAM_ERROR", "BIRDEYE_API_KEY가 유효하지 않습니다. 키를 확인해주세요.");
  }
  if (status !== 200 || !body?.success || !body.data?.items) {
    throw new AdapterError("UPSTREAM_ERROR", `Birdeye 응답 오류 (HTTP ${status})`);
  }
  return body.data.items;
}

export async function fetchSolanaHolders(mint: string): Promise<HoldersResult> {
  const [supplyRes, dasResult, jupResult, price] = await Promise.all([
    rpc<{ value: { uiAmount: number | null; decimals: number } }>("getTokenSupply", [mint]),
    dasMeta(mint),
    jupMeta(mint).catch(() => null),
    jupPrice(mint).catch(() => ({ usd: null, change24h: null })),
  ]);
  const meta = dasResult ?? jupResult;
  const decimals = supplyRes.value.decimals;
  const totalSupply = supplyRes.value.uiAmount;

  const birdeyeKey = process.env.BIRDEYE_API_KEY;
  let holders: HolderRow[] | null = null;
  let partial: HoldersResult["partial"] = null;
  let birdeyeFailReason: "rate" | "other" | null = null;

  if (birdeyeKey) {
    // Birdeye 무료 티어는 순간 호출 제한이 빡빡함 — 실패하면 RPC 상위 20 경로로 폴백
    try {
      const items = await birdeyeTop100(mint, birdeyeKey);
      holders = items.map((h, i) => ({
        rank: i + 1,
        address: h.owner,
        balanceRaw: h.amount,
        balance: h.ui_amount,
        pct: totalSupply && totalSupply > 0 ? (h.ui_amount / totalSupply) * 100 : null,
        usdValue: price.usd != null ? h.ui_amount * price.usd : null,
        tag: null,
      }));
    } catch (e) {
      holders = null;
      birdeyeFailReason =
        e instanceof AdapterError && e.code === "RATE_LIMITED" ? "rate" : "other";
    }
  }
  if (holders === null) {
    // 키 없는 경로: 상위 20 토큰계정 → owner 지갑 주소로 해석
    const largest = await rpc<{ value: Array<{ address: string; uiAmount: number | null; amount: string }> }>(
      "getTokenLargestAccounts",
      [mint],
    );
    const accounts = largest.value.filter((a) => (a.uiAmount ?? 0) > 0);
    const infos = await rpc<{ value: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null> }>(
      "getMultipleAccounts",
      [accounts.map((a) => a.address), { encoding: "jsonParsed" }],
    );
    holders = accounts.map((a, i) => {
      const owner = infos.value[i]?.data?.parsed?.info?.owner ?? a.address;
      const balance = a.uiAmount ?? 0;
      return {
        rank: i + 1,
        address: owner,
        balanceRaw: a.amount,
        balance,
        pct: totalSupply && totalSupply > 0 ? (balance / totalSupply) * 100 : null,
        usdValue: price.usd != null ? balance * price.usd : null,
        tag: null,
      };
    });
    partial = {
      limit: 20,
      reason: !birdeyeKey
        ? "Solana 공개 RPC는 상위 20개까지만 제공합니다. BIRDEYE_API_KEY를 설정하면 상위 100개로 확장됩니다."
        : birdeyeFailReason === "rate"
          ? "Birdeye 호출 한도에 잠시 걸려 상위 20개만 표시 중입니다. 약 1분 후 다시 조회하면 상위 100개가 나옵니다."
          : "Birdeye 조회에 실패해 상위 20개만 표시 중입니다. 문제가 지속되면 BIRDEYE_API_KEY 상태를 확인해주세요.",
    };
  }

  return {
    token: {
      chain: "sol",
      address: mint,
      name: meta?.name ?? "Unknown",
      symbol: meta?.symbol ?? "?",
      decimals,
      totalSupply,
      priceUsd: price.usd,
      priceChange24h: price.change24h,
      holdersCount: null,
    },
    holders,
    partial,
    updatedAt: new Date().toISOString(),
  };
}

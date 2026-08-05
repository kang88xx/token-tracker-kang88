import { fetchJson } from "../util";

/**
 * Xphere XIP-20 토큰의 온체인 가격 계산.
 * PairCreated 로그 전수 스캔(2026-08)으로 발굴한 XpSwap 계열 V2 팩토리들에서
 * 토큰↔USDX(스테이블)·토큰↔WXP 풀을 찾아, 쿼트측 유동성이 가장 큰 풀로 가격을 낸다.
 * - 유동성 $200 미만 풀은 신뢰하지 않고 버린다 (얕은 풀은 실측에서 15%+ 오차)
 * - WXP 환산에는 CoinGecko의 XP/USD를 사용 (5분 캐시)
 * 어떤 실패도 상위로 전파하지 않는다 — 가격은 항상 optional.
 */

const RPC = () => process.env.XPHERE_RPC_URL || "https://en-bkk.x-phere.com";

const FACTORIES = [
  "0xfca8ca57d8f3ba44428ab6bd7cf2960496ca420e", // XEF/USDX·XEF/WXP 풀 보유 — 현행 주력
  "0x707b0c00947ad681a2c6e64925defa94eb664c62",
  "0xad24758a6510f5941a21810f866fdb2fdffe5f07",
  "0x88487cfd6aa83b67790db9d95548cbda0046d081",
];

const USDX = { address: "0xb48e189b1059e4d5c8fd154021a0516ff71a8514", decimals: 6 };
const WXP = { address: "0xb872ce6a30e63080488e5bad468e870abdc94ff5", decimals: 18 };

const MIN_QUOTE_LIQUIDITY_USD = 200;
const ZERO_ADDR = "0x" + "0".repeat(40);

// selector
const SEL_GET_PAIR = "0xe6a43905";
const SEL_GET_RESERVES = "0x0902f1ac";
const SEL_TOKEN0 = "0x0dfe1681";

function pad(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

interface RpcCallResult {
  id: number;
  result?: string;
  error?: unknown;
}

async function batchCall(calls: Array<{ to: string; data: string }>): Promise<(string | null)[]> {
  const payload = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "eth_call",
    params: [{ to: c.to, data: c.data }, "latest"],
  }));
  const { status, body } = await fetchJson<RpcCallResult[]>(RPC(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 8000,
  });
  if (status !== 200 || !Array.isArray(body)) return calls.map(() => null);
  const byId = new Map(body.map((r) => [r.id, r]));
  return calls.map((_, i) => {
    const r = byId.get(i);
    return r && typeof r.result === "string" ? r.result : null;
  });
}

/* XP/USD — CoinGecko, 5분 모듈 캐시 */
let xpCache: { price: number; at: number } | null = null;
async function xpUsd(): Promise<number | null> {
  if (xpCache && Date.now() - xpCache.at < 5 * 60_000) return xpCache.price;
  try {
    const { status, body } = await fetchJson<{ xphere?: { usd?: number } }>(
      "https://api.coingecko.com/api/v3/simple/price?ids=xphere&vs_currencies=usd",
      { timeoutMs: 6000 },
    );
    const p = status === 200 ? body?.xphere?.usd : undefined;
    if (typeof p === "number" && p > 0) {
      xpCache = { price: p, at: Date.now() };
      return p;
    }
  } catch {
    /* 가격은 optional */
  }
  return xpCache?.price ?? null;
}

function hexToBig(word: string): bigint {
  return BigInt("0x" + (word || "0"));
}

/** getReserves 반환값(reserve0, reserve1) 파싱 */
function parseReserves(hex: string): { r0: bigint; r1: bigint } | null {
  const h = hex.replace(/^0x/, "");
  if (h.length < 128) return null;
  return { r0: hexToBig(h.slice(0, 64)), r1: hexToBig(h.slice(64, 128)) };
}

export async function xpswapPrice(
  tokenAddress: string,
  tokenDecimals: number,
): Promise<number | null> {
  try {
    const token = tokenAddress.toLowerCase();
    if (token === USDX.address) return 1;
    const xp = await xpUsd();
    if (token === WXP.address) return xp;

    // 1단계: 모든 팩토리에서 토큰↔USDX, 토큰↔WXP 페어 주소 조회 (배치 1회)
    const quotes = [
      { ...USDX, priceUsd: 1 as number | null },
      { ...WXP, priceUsd: xp },
    ];
    const pairCalls = FACTORIES.flatMap((f) =>
      quotes.map((q) => ({ to: f, data: SEL_GET_PAIR + pad(token) + pad(q.address) })),
    );
    const pairResults = await batchCall(pairCalls);

    const pairs: Array<{ pair: string; quote: (typeof quotes)[number] }> = [];
    pairResults.forEach((res, i) => {
      if (!res) return;
      const addr = "0x" + res.slice(-40);
      if (addr !== ZERO_ADDR && /^0x[0-9a-f]{40}$/.test(addr)) {
        pairs.push({ pair: addr, quote: quotes[i % quotes.length] });
      }
    });
    if (pairs.length === 0) return null;

    // 2단계: 각 페어의 reserves + token0 (배치 1회)
    const detailCalls = pairs.flatMap((p) => [
      { to: p.pair, data: SEL_GET_RESERVES },
      { to: p.pair, data: SEL_TOKEN0 },
    ]);
    const details = await batchCall(detailCalls);

    let best: { price: number; quoteLiqUsd: number } | null = null;
    pairs.forEach((p, i) => {
      const reservesHex = details[i * 2];
      const token0Hex = details[i * 2 + 1];
      if (!reservesHex || !token0Hex || p.quote.priceUsd == null) return;
      const reserves = parseReserves(reservesHex);
      if (!reserves) return;
      const token0 = "0x" + token0Hex.slice(-40);
      const tokenIsToken0 = token0 === token;
      const rToken = tokenIsToken0 ? reserves.r0 : reserves.r1;
      const rQuote = tokenIsToken0 ? reserves.r1 : reserves.r0;
      if (rToken === 0n || rQuote === 0n) return;

      const quoteAmt = Number(rQuote) / 10 ** p.quote.decimals;
      const tokenAmt = Number(rToken) / 10 ** tokenDecimals;
      const quoteLiqUsd = quoteAmt * p.quote.priceUsd;
      if (quoteLiqUsd < MIN_QUOTE_LIQUIDITY_USD) return;

      const price = (quoteAmt * p.quote.priceUsd) / tokenAmt;
      if (!best || quoteLiqUsd > best.quoteLiqUsd) best = { price, quoteLiqUsd };
    });

    return best ? (best as { price: number }).price : null;
  } catch {
    return null;
  }
}

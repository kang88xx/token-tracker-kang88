import { AdapterError, type HolderRow, type HoldersResult } from "../types";
import { burnTag, fetchJson, formatUnits, pctFromRaw, safeDecimals } from "../util";

/**
 * Xphere — TAMSA 익스플로러(Seoullabs 운영)의 비공식 API.
 * 문서화되어 있지 않으므로 스펙 변경에 대비해 방어적으로 파싱한다.
 * (2026-08 실측: 인증 불필요, count=100 1회 호출로 상위 100 반환)
 */
const BASE = "https://xp.tamsa.io/xphere/api/v1";

interface TamsaHoldersResponse {
  msg?: string;
  tokenData?: {
    name?: string;
    symbol?: string;
    tokenDecimal?: number;
    totalSupply?: string;
    price?: number;
  };
  data?: Array<{ address?: string; balance?: string }>;
}

export async function fetchTamsaHolders(address: string): Promise<HoldersResult> {
  const { status, body } = await fetchJson<TamsaHoldersResponse>(
    `${BASE}/token/holders/${address.toLowerCase()}?page=1&count=100&decimal=18`,
  );
  if (status >= 500) throw new AdapterError("UPSTREAM_ERROR", `TAMSA 익스플로러 오류 (HTTP ${status})`);
  if (status !== 200 || body?.msg !== "success" || !body.tokenData) {
    throw new AdapterError("TOKEN_NOT_FOUND", "Xphere(TAMSA)에서 해당 토큰을 찾지 못했습니다.");
  }

  const meta = body.tokenData;
  const decimals = safeDecimals(meta.tokenDecimal);
  const totalSupply = meta.totalSupply ? formatUnits(meta.totalSupply, decimals) : null;
  // TAMSA의 price 필드는 대부분 0 — 0은 '가격 없음'으로 취급
  const priceUsd = meta.price && meta.price > 0 ? meta.price : null;

  const rows = Array.isArray(body.data) ? body.data : [];
  const holders: HolderRow[] = rows
    .filter((r): r is { address: string; balance: string } => Boolean(r?.address && r?.balance))
    .map((r, i) => {
      const balance = formatUnits(r.balance, decimals);
      return {
        rank: i + 1,
        address: r.address,
        balanceRaw: r.balance,
        balance,
        pct: pctFromRaw(r.balance, meta.totalSupply),
        usdValue: priceUsd != null ? balance * priceUsd : null,
        tag: burnTag(r.address),
      };
    });

  if (holders.length === 0) {
    throw new AdapterError("TOKEN_NOT_FOUND", "홀더 데이터가 없습니다. XIP-20 토큰 컨트랙트인지 확인해주세요.");
  }

  return {
    token: {
      chain: "xph",
      address,
      name: meta.name ?? "Unknown",
      symbol: meta.symbol ?? "?",
      decimals,
      totalSupply,
      priceUsd,
      priceChange24h: null,
      holdersCount: null, // TAMSA 홀더 API는 총 홀더 수를 반환하지 않음
    },
    holders,
    partial: null,
    updatedAt: new Date().toISOString(),
  };
}

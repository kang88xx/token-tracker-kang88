import { AdapterError, type ChainId, type HolderRow, type HoldersResult } from "../types";
import { burnTag, fetchJson, formatUnits, pctFromRaw, safeDecimals } from "../util";

interface BsHolderItem {
  address: { hash: string; is_contract: boolean; name: string | null };
  value: string;
}
interface BsHoldersPage {
  items: BsHolderItem[];
  next_page_params: Record<string, string | number> | null;
}
interface BsToken {
  name: string | null;
  symbol: string | null;
  decimals: string | null;
  total_supply: string | null;
  holders_count: string | null;
  exchange_rate: string | null;
}

export async function fetchBlockscoutHolders(
  chain: ChainId,
  baseUrl: string,
  address: string,
): Promise<HoldersResult> {
  const BASE = `${baseUrl}/api/v2`;
  const tokenRes = await fetchJson<BsToken & { message?: string }>(`${BASE}/tokens/${address}`);
  if (tokenRes.status === 429) {
    throw new AdapterError("RATE_LIMITED", "Blockscout 호출 한도 초과 — 잠시 후 다시 시도해주세요.");
  }
  if (tokenRes.status >= 500) {
    throw new AdapterError("UPSTREAM_ERROR", `Blockscout 서버 오류 (HTTP ${tokenRes.status})`);
  }
  if (tokenRes.status === 404 || !tokenRes.body || !tokenRes.body.symbol) {
    throw new AdapterError("TOKEN_NOT_FOUND", "해당 체인에서 토큰을 찾지 못했습니다. 컨트랙트 주소를 확인해주세요.");
  }
  const meta = tokenRes.body;
  const decimals = safeDecimals(meta.decimals);
  const priceUsd = meta.exchange_rate != null ? Number(meta.exchange_rate) : null;
  const totalSupply = meta.total_supply ? formatUnits(meta.total_supply, decimals) : null;

  // Blockscout는 페이지당 50개 — 상위 100개를 위해 2페이지 순회
  const items: BsHolderItem[] = [];
  let pageParams: Record<string, string | number> | null = null;
  for (let page = 0; page < 2; page++) {
    const qs: string = pageParams
      ? "?" +
        Object.entries(pageParams)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const res: { status: number; body: BsHoldersPage | null } = await fetchJson<BsHoldersPage>(
      `${BASE}/tokens/${address}/holders${qs}`,
    );
    if (res.status === 429) throw new AdapterError("RATE_LIMITED", "Blockscout 호출 한도 초과 — 잠시 후 다시 시도해주세요.");
    if (res.status !== 200 || !res.body?.items) {
      throw new AdapterError("UPSTREAM_ERROR", `Blockscout 홀더 목록 응답 오류 (HTTP ${res.status})`);
    }
    items.push(...res.body.items);
    pageParams = res.body.next_page_params;
    if (!pageParams) break;
  }

  const holders: HolderRow[] = items
    .filter(
      (h): h is BsHolderItem =>
        typeof h?.address?.hash === "string" && typeof h?.value === "string",
    )
    .slice(0, 100)
    .map((h, i) => {
    const balance = formatUnits(h.value, decimals);
    return {
      rank: i + 1,
      address: h.address.hash,
      balanceRaw: h.value,
      balance,
      pct: pctFromRaw(h.value, meta.total_supply),
      usdValue: priceUsd != null ? balance * priceUsd : null,
      tag:
        burnTag(h.address.hash) ??
        (h.address.name ? h.address.name.toUpperCase().slice(0, 24) : null) ??
        (h.address.is_contract ? "CONTRACT" : null),
    };
  });

  return {
    token: {
      chain,
      address,
      name: meta.name ?? "Unknown",
      symbol: meta.symbol ?? "?",
      decimals,
      totalSupply,
      priceUsd,
      priceChange24h: null,
      holdersCount: meta.holders_count != null ? Number(meta.holders_count) : null,
    },
    holders,
    partial: null,
    updatedAt: new Date().toISOString(),
  };
}

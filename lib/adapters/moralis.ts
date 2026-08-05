import { AdapterError, type HolderRow, type HoldersResult, type ChainId } from "../types";
import { burnTag, fetchJson, formatUnits, safeDecimals } from "../util";

const BASE = "https://deep-index.moralis.io/api/v2.2";

interface MoralisOwner {
  owner_address: string;
  balance: string;
  balance_formatted: string;
  is_contract: boolean;
  percentage_relative_to_total_supply: number | null;
  usd_value: string | null;
  owner_address_label?: string | null;
}

interface MoralisMeta {
  name: string;
  symbol: string;
  decimals: string;
  total_supply: string | null;
  total_supply_formatted: string | null;
}

function key(): string {
  const k = process.env.MORALIS_API_KEY;
  if (!k) {
    throw new AdapterError(
      "MISSING_API_KEY",
      "MORALIS_API_KEY가 설정되지 않았습니다. https://admin.moralis.com 에서 무료 키를 발급받아 .env.local에 넣어주세요.",
    );
  }
  return k;
}

async function moralisGet<T>(path: string): Promise<T> {
  const { status, body } = await fetchJson<T & { message?: string }>(`${BASE}${path}`, {
    headers: { "X-API-Key": key(), Accept: "application/json" },
  });
  if (status === 429) throw new AdapterError("RATE_LIMITED", "Moralis 호출 한도를 초과했습니다. 잠시 후 다시 시도해주세요.");
  if (status === 400 || status === 404) {
    throw new AdapterError("TOKEN_NOT_FOUND", "해당 체인에서 토큰을 찾지 못했습니다. 컨트랙트 주소와 체인을 확인해주세요.");
  }
  if (status >= 500) throw new AdapterError("UPSTREAM_ERROR", `Moralis 서버 오류 (HTTP ${status})`);
  return body as T;
}

export async function fetchMoralisHolders(
  chain: ChainId,
  moralisChain: string,
  address: string,
): Promise<HoldersResult> {
  const [ownersRes, metaRes, priceRes, statsRes] = await Promise.all([
    moralisGet<{ result: MoralisOwner[] }>(
      `/erc20/${address}/owners?chain=${moralisChain}&order=DESC&limit=100`,
    ),
    moralisGet<MoralisMeta[]>(`/erc20/metadata?chain=${moralisChain}&addresses%5B0%5D=${address}`),
    moralisGet<{ usdPrice?: number; "24hrPercentChange"?: string }>(
      `/erc20/${address}/price?chain=${moralisChain}&include=percent_change`,
    ).catch(() => null),
    moralisGet<{ totalHolders?: number }>(`/erc20/${address}/holders?chain=${moralisChain}`).catch(
      () => null,
    ),
  ]);

  const meta = metaRes?.[0];
  if (!meta || !ownersRes?.result) {
    throw new AdapterError("TOKEN_NOT_FOUND", "토큰 메타데이터를 찾지 못했습니다. 주소와 체인을 확인해주세요.");
  }
  const decimals = safeDecimals(meta.decimals);
  const priceUsd = priceRes?.usdPrice ?? null;

  const holders: HolderRow[] = ownersRes.result
    .filter(
      (o): o is MoralisOwner =>
        typeof o?.owner_address === "string" && typeof o?.balance === "string",
    )
    .map((o, i) => {
    const balance = Number(o.balance_formatted ?? formatUnits(o.balance, decimals));
    const usdFromApi = o.usd_value != null ? Number(o.usd_value) : null;
    return {
      rank: i + 1,
      address: o.owner_address,
      balanceRaw: o.balance,
      balance,
      pct:
        o.percentage_relative_to_total_supply != null
          ? Number(o.percentage_relative_to_total_supply)
          : null,
      usdValue: usdFromApi ?? (priceUsd != null ? balance * priceUsd : null),
      tag:
        burnTag(o.owner_address) ??
        (o.owner_address_label ? o.owner_address_label.toUpperCase().slice(0, 24) : null) ??
        (o.is_contract ? "CONTRACT" : null),
    };
  });

  return {
    token: {
      chain,
      address,
      name: meta.name || "Unknown",
      symbol: meta.symbol || "?",
      decimals,
      totalSupply: meta.total_supply_formatted
        ? Number(meta.total_supply_formatted)
        : meta.total_supply
          ? formatUnits(meta.total_supply, decimals)
          : null,
      priceUsd,
      priceChange24h: priceRes?.["24hrPercentChange"] != null ? Number(priceRes["24hrPercentChange"]) : null,
      holdersCount: statsRes?.totalHolders ?? null,
    },
    holders,
    partial: null,
    updatedAt: new Date().toISOString(),
  };
}

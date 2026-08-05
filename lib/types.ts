export type ChainId = "eth" | "bnb" | "sol" | "rhc" | "xph";

export interface TokenInfo {
  chain: ChainId;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  /** 사람이 읽는 단위로 변환된 총 공급량. 알 수 없으면 null */
  totalSupply: number | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  holdersCount: number | null;
}

export interface HolderRow {
  rank: number;
  address: string;
  /** 원시 잔고 (최소 단위 문자열) */
  balanceRaw: string;
  /** decimals 적용된 잔고 */
  balance: number;
  /** 공급량 대비 % (0–100). 공급량을 모르면 null */
  pct: number | null;
  usdValue: number | null;
  tag: string | null;
}

export interface HoldersResult {
  token: TokenInfo;
  holders: HolderRow[];
  /** 전체 100위를 못 채웠을 때의 사유 (예: Solana 키 없이 상위 20개) */
  partial: { limit: number; reason: string } | null;
  updatedAt: string;
}

export class AdapterError extends Error {
  constructor(
    public code:
      | "TOKEN_NOT_FOUND"
      | "MISSING_API_KEY"
      | "UPSTREAM_ERROR"
      | "INVALID_ADDRESS"
      | "RATE_LIMITED",
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

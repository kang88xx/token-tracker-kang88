import { AdapterError } from "./types";

/** 업스트림이 주는 decimals를 신뢰하지 않는다 — 정수 0~36 범위만 허용 */
export function safeDecimals(v: unknown, fallback = 18): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 36) {
    if (v == null || v === "") return fallback;
    throw new AdapterError("UPSTREAM_ERROR", `비정상 토큰 decimals 값(${String(v)})을 받았습니다.`);
  }
  return n;
}

/** BigInt 기반으로 최소단위 잔고를 표시용 십진수로 변환 (2^53 초과분은 표시 정밀도 내 근사) */
export function formatUnits(raw: string, decimals: number): number {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  if (decimals <= 0) return Number(BigInt(s));
  const b = BigInt(s);
  const base = 10n ** BigInt(decimals);
  const whole = b / base;
  const frac = b % base;
  // 소수부는 표시용 6자리면 충분
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 6);
  return Number(whole.toString()) + Number("0." + (fracStr || "0"));
}

/** 지분율은 표시값이 아니라 원시 정수로 계산 — 부동소수 정밀도 손실 회피. 소수 4자리 */
export function pctFromRaw(rawBalance: string, rawSupply: string | null | undefined): number | null {
  if (!rawSupply || !/^\d+$/.test(rawBalance.trim()) || !/^\d+$/.test(rawSupply.trim())) return null;
  const sup = BigInt(rawSupply.trim());
  if (sup === 0n) return null;
  return Number((BigInt(rawBalance.trim()) * 1_000_000n) / sup) / 10_000;
}

const EVM_BURN = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000001",
]);

export function burnTag(address: string): string | null {
  return EVM_BURN.has(address.toLowerCase()) ? "BURN" : null;
}

export function isEvmAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a);
}

export function isSolanaAddress(a: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; body: T }> {
  const { timeoutMs = 15000, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
    // 어댑터 레벨에서 자체 캐시하므로 Next fetch 캐시는 끈다
    cache: "no-store",
  });
  let body: T;
  try {
    body = (await res.json()) as T;
  } catch {
    body = null as T;
  }
  return { status: res.status, body };
}

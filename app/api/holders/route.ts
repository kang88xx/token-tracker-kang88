import { NextRequest, NextResponse } from "next/server";
import { CHAINS, isChainId } from "@/lib/chains";
import { cacheGet, cacheSet } from "@/lib/cache";
import { AdapterError, type HoldersResult } from "@/lib/types";
import { isEvmAddress, isSolanaAddress } from "@/lib/util";
import { fetchMoralisHolders } from "@/lib/adapters/moralis";
import { fetchBlockscoutHolders } from "@/lib/adapters/blockscout";
import { fetchTamsaHolders } from "@/lib/adapters/tamsa";
import { fetchSolanaHolders } from "@/lib/adapters/solana";

const TTL_MS = 60_000;

/** 동일 키 동시 요청은 업스트림 호출 1회로 병합 */
const inflight = new Map<string, Promise<HoldersResult>>();

/** 경량 per-IP 스로틀 — 분당 30회 (개인 서비스 규모의 남용 방지선) */
const RATE_LIMIT = 30;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    if (rateBuckets.size > 1000) {
      for (const [k, v] of rateBuckets) if (now > v.resetAt) rateBuckets.delete(k);
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";
  if (rateLimited(ip)) {
    return errorResponse("RATE_LIMITED", "요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.", 429);
  }

  const chainParam = req.nextUrl.searchParams.get("chain") ?? "";
  const addressParam = (req.nextUrl.searchParams.get("address") ?? "").trim();

  if (!isChainId(chainParam)) {
    return errorResponse("INVALID_CHAIN", "지원하지 않는 체인입니다.", 400);
  }
  const chain = CHAINS[chainParam];

  const validAddress =
    chain.addressStyle === "evm" ? isEvmAddress(addressParam) : isSolanaAddress(addressParam);
  if (!validAddress) {
    return errorResponse(
      "INVALID_ADDRESS",
      chain.addressStyle === "evm"
        ? "올바른 EVM 컨트랙트 주소(0x + 40자리 hex)를 입력해주세요."
        : "올바른 Solana 민트 주소(base58)를 입력해주세요.",
      400,
    );
  }

  // EVM 주소만 대소문자 정규화 — Solana base58은 대소문자가 의미를 가진다
  const canonical = chain.addressStyle === "evm" ? addressParam.toLowerCase() : addressParam;
  const cacheKey = `${chain.id}:${canonical}`;

  const cached = cacheGet<HoldersResult>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { "x-cache": "HIT" } });
  }

  try {
    let task = inflight.get(cacheKey);
    if (!task) {
      task = (async (): Promise<HoldersResult> => {
        switch (chain.adapter) {
          case "moralis":
            return fetchMoralisHolders(chain.id, chain.moralisChain!, addressParam);
          case "blockscout":
            return fetchBlockscoutHolders(addressParam);
          case "tamsa":
            return fetchTamsaHolders(addressParam);
          case "solana":
            return fetchSolanaHolders(addressParam);
        }
      })();
      inflight.set(cacheKey, task);
      task.finally(() => inflight.delete(cacheKey)).catch(() => {});
    }
    const result = await task;
    cacheSet(cacheKey, result, TTL_MS);
    return NextResponse.json(result, { headers: { "x-cache": "MISS" } });
  } catch (e) {
    if (e instanceof AdapterError) {
      const status =
        e.code === "TOKEN_NOT_FOUND" ? 404
        : e.code === "MISSING_API_KEY" ? 501
        : e.code === "RATE_LIMITED" ? 429
        : 502;
      return errorResponse(e.code, e.message, status);
    }
    // 예기치 못한 오류: 내부 메시지는 서버 로그로만, 클라이언트에는 일반 메시지
    console.error("[holders] unexpected error:", e);
    return errorResponse(
      "UPSTREAM_ERROR",
      "데이터 소스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
      502,
    );
  }
}

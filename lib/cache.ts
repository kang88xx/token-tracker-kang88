interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * 프로세스 내 TTL 캐시. 월 수백 회 조회 규모에서는 이걸로 충분하고,
 * 서버리스 콜드스타트 시 비어 있어도 상위 API 무료 한도에 여유가 크다.
 */
const store = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 500;

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  if (store.size >= MAX_ENTRIES) {
    // 가장 오래된 것부터 정리
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

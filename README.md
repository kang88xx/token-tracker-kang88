# Token Tracker

토큰 컨트랙트 하나로 5개 체인의 **상위 100 홀더**를 추적하는 온체인 애널리틱스.
디자인은 Inhumanz Design System v1.0 (`design/inhumanz-system.css`) 기반.

## 지원 체인 & 데이터 소스

| 체인 | 데이터 소스 | API 키 |
|---|---|---|
| Ethereum | Blockscout 공식 인스턴스 (`eth.blockscout.com`) | 불필요 |
| BNB Chain | Moralis (chain=bsc) | `MORALIS_API_KEY` 필요 |
| Solana | Helius/공개 RPC(상위 20) 또는 Birdeye(상위 100) + Jupiter 메타·가격 | 권장 — `HELIUS_API_KEY`(무료), 선택 — `BIRDEYE_API_KEY` |
| Robinhood Chain | Blockscout 공식 API (`robinhoodchain.blockscout.com`) | 불필요 |
| Xphere | TAMSA 비공식 API + XpSwap 온체인 풀 가격(RPC) + CoinGecko XP/USD | 불필요 |

## 실행

```bash
cp .env.example .env.local   # 키 입력 (Xphere·Robinhood는 키 없이 동작)
npm install
npm run dev                  # http://localhost:3000
```

## 구조

```
app/
  page.tsx             # 대시보드 UI (클라이언트)
  layout.tsx           # 폰트(next/font/local) + 메타
  globals.css          # Inhumanz 디자인 토큰·컴포넌트 스타일
  api/holders/route.ts # GET /api/holders?chain=&address=
lib/
  chains.ts            # 체인 레지스트리 (추가/교체는 여기서)
  adapters/            # moralis · blockscout · tamsa · solana
  cache.ts             # 60s 인메모리 TTL 캐시
  util.ts              # BigInt 안전 단위 변환, 주소 검증
```

## 운영 메모

- **TAMSA는 비공식 API** — 스펙 변경에 대비해 방어적으로 파싱하며, 실패 시 명확한 에러를 반환. 운영사(Seoullabs) 사용 양해 권장.
- Moralis Solana Top Holders API는 2026-06-04 제거됨 → 공개 RPC `getTokenLargestAccounts`(상위 20) 폴백 + Birdeye 확장 구조.
- 캐시 TTL 60초 — 월 100–200회 조회 기준 모든 소스가 무료 한도 내.

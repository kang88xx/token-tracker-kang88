"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CHAINS, CHAIN_ORDER, type ChainConfig } from "@/lib/chains";
import type { ChainId, HoldersResult } from "@/lib/types";

/* ── 포맷 유틸 ─────────────────────────────── */

function fmt(n: number, d = 0): string {
  return n.toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtCompact(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n >= 1 ? fmt(n, n < 100 ? 2 : 0) : n.toPrecision(3);
}

function fmtPrice(n: number): string {
  if (n >= 1) return "$" + fmt(n, 2);
  return "$" + n.toPrecision(3);
}

function shortAddr(a: string): string {
  return a.length > 12 ? a.slice(0, 6) + "…" + a.slice(-4) : a;
}

/* ── 분포 세그먼트 ─────────────────────────── */

const SEG_COLORS = ["#664DFF", "#00A6E0", "#84CC04", "#C2C9D2"];
const SEG_INK = ["#FFFFFF", "#FFFFFF", "#000F19", "#000F19"];

interface Segment {
  label: string;
  ko: string;
  pct: number;
}

function buildSegments(data: HoldersResult): Segment[] | null {
  const withPct = data.holders.filter((h) => h.pct != null);
  if (withPct.length < 10) return null;
  const sum = (from: number, to: number) =>
    withPct.slice(from, to).reduce((a, h) => a + (h.pct ?? 0), 0);
  const top10 = sum(0, 10);
  const segs: Segment[] = [{ label: "TOP 10", ko: "지갑 10개", pct: top10 }];
  if (withPct.length > 50) {
    segs.push({ label: "11–50", ko: "지갑 40개", pct: sum(10, 50) });
    segs.push({ label: "51–100", ko: `지갑 ${withPct.length - 50}개`, pct: sum(50, 100) });
  } else if (withPct.length > 10) {
    segs.push({
      label: `11–${withPct.length}`,
      ko: `지갑 ${withPct.length - 10}개`,
      pct: sum(10, withPct.length),
    });
  }
  const covered = segs.reduce((a, s) => a + s.pct, 0);
  segs.push({ label: "OTHERS", ko: "나머지 전체", pct: Math.max(0, 100 - covered) });
  return segs;
}

/* ── 툴팁 ─────────────────────────────────── */

interface TipState {
  html: React.ReactNode;
  x: number;
  y: number;
}

/* ── 페이지 ───────────────────────────────── */

type ApiError = { code: string; message: string };

export default function Page() {
  const [chainId, setChainId] = useState<ChainId>("xph");
  const [input, setInput] = useState<string>(CHAINS.xph.demoToken!.address);
  const [data, setData] = useState<HoldersResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<"all" | "t10" | "mid" | "low">("all");
  const [tip, setTip] = useState<TipState | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (chain: ChainId, address: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/holders?chain=${chain}&address=${encodeURIComponent(address.trim())}`,
        { signal: ac.signal },
      );
      const body = await res.json();
      if (!res.ok) {
        setData(null);
        setError(body?.error ?? { code: "UNKNOWN", message: "요청에 실패했습니다." });
      } else {
        setData(body as HoldersResult);
        setRange("all");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setData(null);
        setError({ code: "NETWORK", message: "네트워크 오류 — 연결을 확인해주세요." });
      }
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }, []);

  // 첫 진입: 키 없이 동작하는 Xphere 데모 토큰을 라이브로 로드
  useEffect(() => {
    void load("xph", CHAINS.xph.demoToken!.address);
  }, [load]);

  const selectChain = (c: ChainConfig) => {
    setChainId(c.id);
    const demo = c.demoToken;
    if (demo) {
      setInput(demo.address);
      void load(c.id, demo.address);
    } else {
      setInput("");
      setData(null);
      setError(null);
    }
  };

  const submit = () => {
    if (input.trim() && !loading) void load(chainId, input);
  };

  const copyContract = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.token.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch {
      /* clipboard 권한 없음 — 무시 */
    }
  };

  const showTip = (e: React.MouseEvent, node: React.ReactNode) => {
    setTip({ html: node, x: e.clientX, y: e.clientY });
  };

  /* 파생값 */
  const holders = data?.holders ?? [];
  const pctKnown = holders.length > 0 && holders[0].pct != null;
  const top10Sum = pctKnown
    ? holders.slice(0, 10).reduce((a, h) => a + (h.pct ?? 0), 0)
    : null;
  const topAllSum = pctKnown ? holders.reduce((a, h) => a + (h.pct ?? 0), 0) : null;
  const segments = data ? buildSegments(data) : null;
  const score = top10Sum != null ? Math.min(100, Math.round(top10Sum * 1.6)) : null;
  const maxPct = holders.length ? holders[0].balance : 0;
  const usdKnown = data?.token.priceUsd != null;

  const rangeRows =
    range === "t10" ? holders.slice(0, 10)
    : range === "mid" ? holders.slice(10, 50)
    : range === "low" ? holders.slice(50, 100)
    : holders;

  const chain = CHAINS[chainId];
  // 표시용 체인은 로드된 데이터 기준 — 전환 로딩 중 이전 토큰에 새 체인 배지가 붙는 것 방지
  const dataChain = data ? CHAINS[data.token.chain] : chain;
  const updatedLabel = data
    ? new Date(data.updatedAt).toLocaleTimeString("ko-KR", { hour12: false })
    : null;

  return (
    <>
      <div className="page-rail">
        <div>
          <span className="dot" />
          TOKEN TRACKER
        </div>
        <div className="c">HOLDER ANALYTICS — TOP 100</div>
        <div className="r">5 CHAINS · LIVE</div>
      </div>

      <div className="hero">
        <div className="h-inner">
          <div className="crumb">
            <span>INHUMANZ PRODUCT LAB — V1.0</span>
            <span>NO BOUNDARIES. ONLY POSSIBILITIES.</span>
          </div>
          <h1 className="wordmark">
            tokentracker<span className="ac">.</span>
          </h1>
          <div className="h-tag">컨트랙트 하나로 홀더 1–100위를 읽는다</div>

          <div className="console">
            <div className="search">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={
                  chain.addressStyle === "evm"
                    ? "토큰 컨트랙트 주소를 붙여넣으세요 (0x…)"
                    : "토큰 민트 주소를 붙여넣으세요 (base58)"
                }
                spellCheck={false}
                aria-label="토큰 컨트랙트 주소"
              />
              <button onClick={submit} disabled={loading}>
                {loading ? "조회 중…" : "조회"}
              </button>
            </div>
            <div className="chains" role="group" aria-label="체인 선택">
              {CHAIN_ORDER.map((id) => (
                <button
                  key={id}
                  className="chain"
                  aria-pressed={id === chainId}
                  onClick={() => selectChain(CHAINS[id])}
                >
                  <span className="dot" />
                  {CHAINS[id].name}
                </button>
              ))}
            </div>
          </div>

          <div className="h-token">
            {data ? (
              <>
                <div className="token-tile">{data.token.symbol.slice(0, 2)}</div>
                <div>
                  <div className="token-name">
                    {data.token.name}
                    <span className="sym">
                      {data.token.symbol} · {dataChain.badge}
                    </span>
                  </div>
                  <div className="token-meta">
                    <span className="tag ghost-light">{dataChain.name}</span>
                    <button
                      className="tag ghost-light addr-btn no-caps"
                      onClick={copyContract}
                      title="클릭하여 복사"
                    >
                      <span className="dot" />
                      {copied ? "COPIED" : shortAddr(data.token.address)}
                    </button>
                    {updatedLabel && (
                      <span className="tag ghost-light">
                        <span className="ko">업데이트 {updatedLabel}</span>
                      </span>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="token-name" style={{ opacity: 0.4 }}>
                {loading ? (
                  <span className="loading-hint">홀더 데이터 불러오는 중…</span>
                ) : (
                  "컨트랙트 주소를 조회해주세요"
                )}
              </div>
            )}
          </div>

          <div className="h-sub">
            <div>
              <div className="lbl">
                TOTAL HOLDERS <span className="ko">— 총 홀더</span>
              </div>
              <div className="val">
                {data?.token.holdersCount != null ? fmt(data.token.holdersCount) : "—"}
              </div>
              <div className="sub">
                {data?.token.holdersCount != null ? "ON-CHAIN INDEXED" : "N/A ON THIS CHAIN"}
              </div>
            </div>
            <div>
              <div className="lbl">
                TOP 10 SHARE <span className="ko">— 상위 10 비중</span>
              </div>
              <div className="val">{top10Sum != null ? top10Sum.toFixed(1) + "%" : "—"}</div>
              <div className="sub">
                {top10Sum == null ? "—"
                  : top10Sum >= 45 ? <>HIGH CONCENTRATION <span className="ko">— 주의</span></>
                  : top10Sum >= 30 ? <>MODERATE <span className="ko">— 보통</span></>
                  : <>LOW <span className="ko">— 분산 양호</span></>}
              </div>
            </div>
            <div>
              <div className="lbl">
                TOP {data?.partial ? data.partial.limit : 100} SHARE{" "}
                <span className="ko">— 상위 {data?.partial ? data.partial.limit : 100} 비중</span>
              </div>
              <div className="val">{topAllSum != null ? topAllSum.toFixed(1) + "%" : "—"}</div>
              <div className="sub">TOP {holders.length || "—"} WALLETS COMBINED</div>
            </div>
            <div>
              <div className="lbl">
                PRICE <span className="ko">— 토큰 가격</span>
              </div>
              <div className="val">
                {data?.token.priceUsd != null ? fmtPrice(data.token.priceUsd) : "—"}
              </div>
              <div className="sub">
                {data?.token.priceChange24h != null ? (
                  <>
                    24H{" "}
                    <span className={data.token.priceChange24h >= 0 ? "up" : "down"}>
                      {data.token.priceChange24h >= 0 ? "▲ +" : "▼ "}
                      {data.token.priceChange24h.toFixed(1)}%
                    </span>
                  </>
                ) : (
                  <span className="ko">가격 데이터 없음</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main>
        {error && (
          <div className="state-panel error">
            <div className="st-label">ERROR — {error.code}</div>
            <div className="st-msg">{error.message}</div>
            {error.code === "MISSING_API_KEY" && (
              <div className="st-hint">.env.local → MORALIS_API_KEY=발급받은키 → 서버 재시작</div>
            )}
          </div>
        )}

        {!error && !data && loading && (
          <div className="state-panel info">
            <div className="st-label loading-hint">LOADING</div>
            <div className="st-msg">체인에서 홀더 데이터를 가져오는 중입니다…</div>
          </div>
        )}

        {data && (
          <>
            <section className="ds">
              <div className="eyebrow">
                <div className="num">01</div>
                <div className="label">Top 10 Holders</div>
                <div className="rule" />
                {top10Sum != null && (
                  <div className="aside">Σ {top10Sum.toFixed(1)}% OF SUPPLY</div>
                )}
              </div>
              <h2 className="ds-title">상위 10개 지갑</h2>
              <p className="ds-lede">
                공급량 대비 보유 비중 기준. 행에 마우스를 올리면 정확한 수량과 평가액이 표시됩니다.
              </p>

              {data.partial && <div className="partial-note">{data.partial.reason}</div>}

              <div className="row">
                <div className="c-8">
                  <div className="demo">
                    <div className="demo-caption">
                      <span>RANK / WALLET / SHARE</span>
                      <span className="hint ko">바 길이 = 1위 대비 상대 비중</span>
                    </div>
                    <div className="top10">
                      {holders.slice(0, 10).map((h) => (
                        <div
                          key={h.address + h.rank}
                          className={`t-row${h.rank <= 3 ? " top3" : ""}`}
                          onMouseMove={(e) =>
                            showTip(
                              e,
                              <>
                                <span className="tk">#{h.rank}</span> {shortAddr(h.address)}
                                <br />
                                <span className="tk">QTY</span>{" "}
                                <span className="tv">
                                  {fmt(Math.round(h.balance))} {data.token.symbol}
                                </span>
                                {h.pct != null && (
                                  <>
                                    <br />
                                    <span className="tk">SHARE</span>{" "}
                                    <span className="tv">{h.pct.toFixed(2)}%</span>
                                  </>
                                )}
                                {h.usdValue != null && (
                                  <>
                                    <br />
                                    <span className="tk">VALUE</span>{" "}
                                    <span className="tv">${fmtCompact(h.usdValue)}</span>
                                  </>
                                )}
                              </>,
                            )
                          }
                          onMouseLeave={() => setTip(null)}
                        >
                          <div className="rank">{h.rank < 10 ? "0" + h.rank : h.rank}</div>
                          <div className="t-who">
                            <div className="t-addr">{shortAddr(h.address)}</div>
                            <div className="t-tags">
                              <span className={`tag${h.tag === "BURN" ? "" : h.tag ? " purple" : ""}`}>
                                {h.tag ?? "WALLET"}
                              </span>
                            </div>
                          </div>
                          <div className="t-barcell">
                            <div className="t-track">
                              <div
                                className="t-fill"
                                style={{
                                  width: maxPct > 0 ? `${(h.balance / maxPct) * 100}%` : "0%",
                                }}
                              />
                            </div>
                          </div>
                          <div className="t-bal">
                            {fmtCompact(h.balance)} {data.token.symbol}
                            <small>{h.usdValue != null ? "$" + fmtCompact(h.usdValue) : "—"}</small>
                          </div>
                          <div className="t-pct">
                            {h.pct != null ? h.pct.toFixed(2) + "%" : "—"}
                            <small>{h.usdValue != null ? "$" + fmtCompact(h.usdValue) : ""}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="c-4">
                  <div className="demo">
                    <div className="demo-caption">
                      <span>
                        DISTRIBUTION <span className="ko">— 보유 분포</span>
                      </span>
                    </div>
                    {score != null && (
                      <div className="score-blk">
                        <div className="figure">
                          {score}
                          <sup>/100</sup>
                        </div>
                        <div className="lbl">집중도 점수</div>
                        <div className="cap">
                          {score >= 60
                            ? "상위 지갑 쏠림이 큽니다. 대형 이동 추적을 권장합니다."
                            : score >= 40
                              ? "보통 수준의 집중도입니다."
                              : "분산이 양호한 편입니다."}
                        </div>
                        <div className="gauge">
                          <i
                            style={{
                              width: `${score}%`,
                              background:
                                score >= 60 ? "#D9203E" : score >= 40 ? "#664DFF" : "#84CC04",
                            }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="dist-body">
                      {segments ? (
                        <>
                          <div className="dist-bar">
                            {segments.map((s, i) => (
                              <div
                                key={s.label}
                                className="dist-seg"
                                style={{ flex: `${Math.max(s.pct, 0.5)} 0 0`, background: SEG_COLORS[i] }}
                                onMouseMove={(e) =>
                                  showTip(
                                    e,
                                    <>
                                      <span className="tk">{s.label}</span> {s.ko}
                                      <br />
                                      <span className="tk">SHARE</span>{" "}
                                      <span className="tv">{s.pct.toFixed(1)}%</span>
                                    </>,
                                  )
                                }
                                onMouseLeave={() => setTip(null)}
                              >
                                {s.pct >= 13 && (
                                  <span style={{ color: SEG_INK[i] }}>{s.pct.toFixed(0)}%</span>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="dist-legend">
                            {segments.map((s, i) => (
                              <div className="dl-row" key={s.label}>
                                <span className="dl-swatch" style={{ background: SEG_COLORS[i] }} />
                                {s.label} <small>{s.ko}</small>
                                <b>{s.pct.toFixed(1)}%</b>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="st-msg" style={{ fontSize: 13, color: "var(--gray-500)" }}>
                          이 토큰은 총 공급량 정보가 없어 분포를 계산할 수 없습니다.
                        </div>
                      )}
                      <div className="risk">
                        <div className="risk-title">Signals</div>
                        <div className="risk-row">
                          <span>최대 단일 지갑</span>
                          <b>{holders[0]?.pct != null ? holders[0].pct.toFixed(1) + "%" : "—"}</b>
                        </div>
                        <div className="risk-row">
                          <span>표시 지갑 수</span>
                          <b>{holders.length}</b>
                        </div>
                        <div className="risk-row">
                          <span>총 공급량</span>
                          <b>
                            {data.token.totalSupply != null
                              ? fmtCompact(data.token.totalSupply)
                              : "—"}
                          </b>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="ds">
              <div className="eyebrow">
                <div className="num">02</div>
                <div className="label">Full Leaderboard</div>
                <div className="rule" />
              </div>
              <h2 className="ds-title">홀더 순위 1–{holders.length}</h2>
              <p className="ds-lede">
                {holders.length >= 100
                  ? "전체 상위 100개 지갑. 구간 필터로 11–50위, 51–100위 뭉치를 따로 볼 수 있습니다."
                  : `이 체인에서 확보 가능한 상위 ${holders.length}개 지갑입니다.`}
              </p>

              <div className="demo">
                <div className="demo-caption">
                  <span>Holders Table</span>
                  <div className="range-tabs">
                    {(
                      [
                        ["all", `전체 1–${holders.length}`],
                        ["t10", "1–10"],
                        ["mid", "11–50"],
                        ["low", "51–100"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        className="range-tab"
                        aria-pressed={range === key}
                        disabled={
                          (key === "mid" && holders.length <= 10) ||
                          (key === "low" && holders.length <= 50)
                        }
                        onClick={() => setRange(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>순위</th>
                        <th>지갑 주소</th>
                        <th>보유 수량</th>
                        <th>지분율</th>
                        <th>평가액 USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rangeRows.map((h) => (
                        <tr key={h.address + h.rank}>
                          <td>{h.rank < 10 ? "0" + h.rank : h.rank}</td>
                          <td>
                            <span className="addr">{shortAddr(h.address)}</span>
                            {h.tag && (
                              <span className={`tag${h.tag === "BURN" ? "" : " purple"}`}>
                                {h.tag}
                              </span>
                            )}
                          </td>
                          <td>{fmt(Math.round(h.balance))}</td>
                          <td>
                            <span className="pctcell">
                              {h.pct != null ? h.pct.toFixed(2) + "%" : "—"}
                            </span>
                            <span className="sharebar">
                              <i
                                style={{
                                  width: maxPct > 0 ? `${(h.balance / maxPct) * 100}%` : "0%",
                                }}
                              />
                            </span>
                          </td>
                          <td>{h.usdValue != null ? "$" + fmt(Math.round(h.usdValue)) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!usdKnown && (
                  <div className="demo-caption" style={{ borderTop: "1px solid var(--rule)", borderBottom: 0 }}>
                    <span className="hint ko">
                      이 토큰은 시장 가격 데이터가 없어 평가액을 표시하지 않습니다.
                    </span>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <div className="footer-wrap">
        <div className="ds-footer">
          <div className="ft-top">
            <div>
              <div className="word">
                tokentracker<span className="ac">.</span>
              </div>
              <p>
                토큰 컨트랙트 하나로 5개 체인의 홀더 분포를 추적하는 온체인 애널리틱스. 상위 10개
                지갑을 중심으로 집중도 리스크를 읽습니다.
              </p>
            </div>
            <div>
              <h5>Chains</h5>
              <ul>
                <li>
                  Ethereum <span className="mono-sub">EVM</span>
                </li>
                <li>
                  BNB Chain <span className="mono-sub">EVM</span>
                </li>
                <li>
                  Solana <span className="mono-sub">SVM</span>
                </li>
                <li>
                  Robinhood Chain <span className="mono-sub">EVM L2</span>
                </li>
                <li>
                  Xphere <span className="mono-sub">EVM</span>
                </li>
              </ul>
            </div>
            <div>
              <h5>Data</h5>
              <ul>
                <li>
                  Moralis <span className="mono-sub">ETH · BNB</span>
                </li>
                <li>
                  Solana RPC + Jupiter <span className="mono-sub">SOL</span>
                </li>
                <li>
                  Blockscout <span className="mono-sub">Robinhood</span>
                </li>
                <li>
                  TAMSA <span className="mono-sub">Xphere</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="ft-bot">
            <span>ⓒ 2026 TOKEN TRACKER — DESIGN: INHUMANZ BRAND GUIDE 1.0</span>
            <span>QUESTRIAL · POPPINS · PRETENDARD · JETBRAINS MONO</span>
          </div>
        </div>
      </div>

      {tip && (
        <div
          className="tip"
          style={{
            left: Math.min(tip.x + 14, typeof window !== "undefined" ? window.innerWidth - 300 : tip.x),
            top: tip.y - 90 < 8 ? tip.y + 18 : tip.y - 90,
          }}
        >
          {tip.html}
        </div>
      )}
    </>
  );
}

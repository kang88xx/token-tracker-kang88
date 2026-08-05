import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const questrial = localFont({
  src: "./fonts/questrial.woff2",
  weight: "400",
  variable: "--font-questrial",
  display: "swap",
});

const poppins = localFont({
  src: [
    { path: "./fonts/poppins500.woff2", weight: "500" },
    { path: "./fonts/poppins600.woff2", weight: "600" },
  ],
  variable: "--font-poppins",
  display: "swap",
});

const jbmono = localFont({
  src: "./fonts/jbmono.woff2",
  weight: "100 800",
  variable: "--font-jbmono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Token Tracker — Holder Analytics",
  description:
    "토큰 컨트랙트 하나로 5개 체인(Ethereum·BNB·Solana·Robinhood·Xphere)의 상위 100 홀더를 추적하는 온체인 애널리틱스",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${questrial.variable} ${poppins.variable} ${jbmono.variable}`}>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

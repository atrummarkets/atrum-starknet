import type { Metadata } from "next";
import { Syne, Manrope, Geist_Mono } from "next/font/google";
import "./globals.css";

const syne = Syne({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-syne" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

const TITLE = "Atrum — sealed-bid prediction markets on Starknet";
const DESCRIPTION =
  "Your order stays unreadable until it is already binding. Sealed batches, one clearing price, and positions you can sell before the event resolves.";

export const metadata: Metadata = {
  metadataBase: new URL("https://strk20.atrum.fun"),
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, url: "https://strk20.atrum.fun", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, creator: "@AtrumMarkets" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${manrope.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

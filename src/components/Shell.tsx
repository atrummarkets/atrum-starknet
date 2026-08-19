"use client";

/**
 * The product chrome: wordmark, navigation, network.
 *
 * Shared across every route so the app reads as one thing rather than three pages that
 * happen to share a stylesheet.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NET } from "@/lib/atrum/config";

const NAV = [
  { href: "/app", label: "Markets" },
  { href: "/app/portfolio", label: "Portfolio" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();

  return (
    <>
      <div className="atmos" aria-hidden="true">
        <div className="backdrop" />
        <div className="fog fog-a" />
        <div className="fog fog-b" />
      </div>

      <div className="app">
        <header className="topbar">
          <Link href="/app" className="wordmark" aria-label="Atrum">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wordmark-chrome.png" alt="Atrum" />
          </Link>

          <nav className="nav">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="nav-link"
                aria-current={
                  n.href === "/app" ? (path === "/app" ? "page" : undefined)
                  : path.startsWith(n.href) ? "page" : undefined
                }
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <span className="chain">Starknet · {NET}</span>
        </header>

        {children}

        <footer>
          <span>Built on Starknet · STRK20</span>
          <span>
            <a href="https://github.com/atrummarkets/atrum-starknet" target="_blank" rel="noreferrer">
              Source
            </a>
            {"  ·  "}
            <a href="https://x.com/AtrumMarkets" target="_blank" rel="noreferrer">
              @AtrumMarkets
            </a>
          </span>
        </footer>
      </div>
    </>
  );
}

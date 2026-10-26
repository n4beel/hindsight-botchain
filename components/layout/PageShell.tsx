"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import ConnectButton from "@/components/ui/ConnectButton";
import NetworkBadge from "@/components/botchain/NetworkBadge";
import BuiltOnBotChain from "@/components/botchain/BuiltOnBotChain";
import { app } from "@/lib/app-config";
import { footerLinks } from "@/lib/botchain/chain";

export type NavItem = { href: string; label: string };

export interface PageShellProps {
  children: ReactNode;
  nav?: NavItem[];
  title?: string;
  subtitle?: string;
  description?: string;
}

export const DEFAULT_NAV: NavItem[] = [
  { href: "/", label: "Timeline Feed" },
  { href: "/new", label: "Commit Prediction" },
  { href: "/mine", label: "My Predictions" },
];

/**
 * Archetype R · Timeline PageShell.
 *
 * Petrol canvas (#0E2A35) with pale ink (#D9ECF2), thin timeline hairlines (#24505F),
 * and apricot accents (#F2B880). No standard top bar: navigation, network status,
 * and connect button sit alongside the timeline head, and footer attribution forms
 * the final "Colophon" node.
 */
export default function PageShell({
  children,
  nav = DEFAULT_NAV,
  title,
  subtitle,
  description,
}: PageShellProps) {
  const pathname = usePathname();
  const desc = description || subtitle;
  const { site, explorer } = footerLinks();

  return (
    <div className="timeline-atmosphere min-h-[100dvh] flex flex-col justify-between text-[#D9ECF2]">
      {/* Spine head & top controls */}
      <header className="w-full max-w-[880px] mx-auto px-4 sm:px-6 pt-6 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#24505F]/80 pb-4">
          <div className="flex items-center gap-3">
            {/* Timeline Spine Head handle */}
            <Link
              href="/"
              className="flex items-center gap-2.5 group no-underline text-inherit"
            >
              <span
                className="w-3 h-3 rounded-full bg-[#F2B880] ring-4 ring-[#F2B880]/20 shadow-[0_0_10px_rgba(242,184,128,0.5)] transition-transform group-hover:scale-110"
                aria-hidden="true"
              />
              <span className="serif text-[18px] tracking-wide font-medium text-[#D9ECF2]">
                {app.name}
              </span>
            </Link>
            <span className="text-[#658592] text-[12px] hidden sm:inline" aria-hidden="true">
              /
            </span>
            <span className="text-[12px] text-[#8FB0BC] hidden sm:inline">
              Commit-Reveal Forecaster
            </span>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <nav className="flex items-center gap-1">
              {nav.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`text-[12px] px-2.5 py-1 rounded transition-colors no-underline ${
                      active
                        ? "bg-[#F2B880]/15 text-[#F2B880] font-medium"
                        : "text-[#8FB0BC] hover:text-[#D9ECF2]"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <NetworkBadge />
            <div className="w-[140px] sm:w-[170px] shrink-0">
              <ConnectButton />
            </div>
          </div>
        </div>
      </header>

      {/* Main page content */}
      <main className="w-full max-w-[880px] mx-auto px-4 sm:px-6 py-6 md:py-8 flex-1">
        {(title || desc) && (
          <div className="mb-8 pl-4 sm:pl-6 border-l-2 border-[#F2B880]/70">
            {title && (
              <h1 className="serif text-[28px] sm:text-[34px] md:text-[38px] font-normal tracking-tight text-[#D9ECF2] leading-[1.15]">
                {title}
              </h1>
            )}
            {desc && (
              <p className="text-[13px] sm:text-[14px] text-[#8FB0BC] mt-2 leading-relaxed max-w-[640px]">
                {desc}
              </p>
            )}
          </div>
        )}

        {children}
      </main>

      {/* Final timeline node: Colophon */}
      <footer className="w-full max-w-[880px] mx-auto px-4 sm:px-6 py-8 border-t border-[#24505F]/80 text-[#8FB0BC] text-[12px]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="w-2.5 h-2.5 rounded-full border-2 border-[#24505F] bg-[#0E2A35]"
              aria-hidden="true"
            />
            <span className="font-serif italic text-[#D9ECF2]">Colophon</span>
            <span className="text-[#658592]">&middot;</span>
            <BuiltOnBotChain className="uppercase tracking-[0.06em] text-[11px] text-[#8FB0BC]" />
          </div>

          <div className="flex items-center gap-4 text-[11px] text-[#658592]">
            <a
              href={site}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[#F2B880] underline"
            >
              botchain.ai
            </a>
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[#F2B880] underline"
            >
              BOT Chain Explorer
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { no } from "@/lib/locale/no";
import { Icon } from "./Icon";

// Shared top bar for the sub-pages: brand mark → forsiden, an optional back
// link and title, and a slot on the right (e.g. «Avbryt»). Not used on the
// full-screen pages (storskjerm, dommertelefon, publikumsvisning). Hidden in
// print. No hooks, so it renders on the server as well as in client trees.
export function SiteHeader({
  back,
  title,
  children,
}: {
  back?: { href: string; label: string };
  title?: string;
  children?: ReactNode;
}) {
  return (
    <header className="site-header">
      <div className="site-header-in">
        {back && (
          <>
            <Link href={back.href} className="back-link site-back">
              <Icon name="chevronLeft" size={18} />
              {back.label}
            </Link>
            <span className="site-header-sep" aria-hidden="true" />
          </>
        )}
        <Link href="/" className="brand site-brand" aria-label={`${no.brand}. ${no.header.home}`}>
          <span className="brand-mark" aria-hidden="true">T</span>
          {no.brand}
        </Link>
        {title && <span className="site-title">{title}</span>}
        {children && <div className="site-header-actions">{children}</div>}
      </div>
    </header>
  );
}

/** The usual back link: up to forsiden. */
export const backToHome = { href: "/", label: no.header.home } as const;

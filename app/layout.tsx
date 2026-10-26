import type { Metadata } from "next";
import { Playfair_Display, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { ThemeToggle } from "@/lib/client/ThemeToggle";

// Resolve dark/light before paint (stored choice → system fallback) to avoid a
// flash. Sets data-theme on <html>; globals.css keys the light overrides off it.
const themeScript = `(function(){try{var t=localStorage.getItem('turnering:theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

const display = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});
const body = Hanken_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "SundayTurnering – turnering på storskjerm",
  description:
    "Turneringsstyring for skole og arrangement. Storskjermen viser stillingen, og dommerne fører resultater fra mobilen.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="no"
      className={`${display.variable} ${body.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Backstop for the Referrer-Policy header: prerendered pages served
            from OpenNext's cache interception may skip next.config headers(),
            and /kontroll?code= carries the control code in its URL. */}
        <meta name="referrer" content="no-referrer" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        {/* After the page: on phones it sits at the end of the flow (CSS). */}
        <ThemeToggle />
      </body>
    </html>
  );
}

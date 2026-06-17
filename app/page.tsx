import Link from "next/link";
import { no } from "@/lib/locale/no";

export default function Home() {
  return (
    <main className="landing">
      <div className="landing-card stack">
        <div className="row" style={{ justifyContent: "center" }}>
          <span className="brand">
            <span className="brand-mark">T</span>
            {no.brand}
          </span>
        </div>
        <h1>
          Turneringen din,
          <br />
          <span className="accent">klar på storskjerm.</span>
        </h1>
        <p className="landing-sub">{no.landing.blurb}</p>
        <div className="stack" style={{ gap: 12 }}>
          <Link href="/ny" className="btn btn-gold btn-lg btn-block">
            {no.landing.createCta}
          </Link>
          <Link href="/hurtig" className="btn btn-lg btn-block">
            {no.landing.quickCta}
          </Link>
          <Link href="/kontroll" className="btn btn-block">
            {no.landing.controlCta}
          </Link>
          <Link href="/tavle" className="btn btn-ghost btn-block">
            {no.landing.boardCta}
          </Link>
        </div>
      </div>
    </main>
  );
}

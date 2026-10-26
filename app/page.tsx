import Link from "next/link";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { MyTournaments } from "./MyTournaments";

const L = no.landing;

export default function Home() {
  return (
    <main className="landing">
      <div className="landing-in">
        <header className="landing-hero">
          <span className="brand">
            <span className="brand-mark">T</span>
            {no.brand}
          </span>
          <h1>
            Turneringen din,
            <br />
            <span className="accent">klar på storskjerm.</span>
          </h1>
          <p className="landing-sub">{L.blurb}</p>
        </header>

        <section className="role-grid" aria-label={L.rolesLabel}>
          <article className="card role-card role-card-main">
            <span className="role-icon">
              <Icon name="trophy" size={24} />
            </span>
            <h2>{L.organiserTitle}</h2>
            <p>{L.organiserBlurb}</p>
            <div className="role-action">
              <Link href="/ny" className="btn btn-gold btn-lg btn-block">
                {L.createCta}
              </Link>
              <MyTournaments />
            </div>
          </article>

          <article className="card role-card">
            <span className="role-icon">
              <Icon name="code" size={24} />
            </span>
            <h2>{L.refereeTitle}</h2>
            <p>{L.refereeBlurb}</p>
            <div className="role-action">
              <Link href="/kontroll" className="btn btn-lg btn-block">
                {L.refereeCta}
              </Link>
            </div>
          </article>

          <article className="card role-card">
            <span className="role-icon">
              <Icon name="phone" size={24} />
            </span>
            <h2>{L.followTitle}</h2>
            <p>{L.followBlurb}</p>
            <p className="role-note">{L.followNote}</p>
          </article>
        </section>

        <nav className="landing-other" aria-label={L.otherLabel}>
          <Link href="/hurtig" className="other-link">
            <Icon name="quick" size={22} />
            <span>
              <strong>{L.quickCta}</strong>
              <span>{L.quickBlurb}</span>
            </span>
          </Link>
          <Link href="/tavle" className="other-link">
            <Icon name="screen" size={22} />
            <span>
              <strong>{L.boardCta}</strong>
              <span>{L.boardBlurb}</span>
            </span>
          </Link>
        </nav>

        <section className="how" aria-labelledby="how-title">
          <h2 id="how-title">{L.howTitle}</h2>
          <ol className="how-steps">
            {L.howSteps.map((s, i) => (
              <li key={s.title}>
                <span className="how-num" aria-hidden="true">{i + 1}</span>
                <div>
                  <strong>{s.title}</strong>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="center-screen">
      <div className="empty stack" style={{ alignItems: "center", gap: 14 }}>
        <div>Fant ikke siden.</div>
        <Link className="btn btn-gold" href="/">
          Til forsiden
        </Link>
      </div>
    </main>
  );
}

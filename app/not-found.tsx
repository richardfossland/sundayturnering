import Link from "next/link";
import { no } from "@/lib/locale/no";

export default function NotFound() {
  return (
    <main className="center-screen">
      <div className="empty stack" style={{ alignItems: "center", gap: 14 }}>
        <div>{no.common.notFound}</div>
        <Link className="btn btn-gold" href="/">
          {no.header.home}
        </Link>
      </div>
    </main>
  );
}

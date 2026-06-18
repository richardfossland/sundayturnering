import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/server/auth";
import { listTournamentsByOrganiser } from "@/lib/server/store";
import { AdminDashboard } from "./AdminDashboard";

// Admin dashboard (Sunday Account gated). Middleware already redirects an
// unauthenticated visitor to /admin/login; this server component is the second
// gate: requireAdmin() throws (401 not signed in / 403 not on the allowlist),
// and we bounce to /admin/login rather than render. The initial list is fetched
// server-side so the page paints with data; the client refetches after actions.
export default async function AdminPage() {
  let userId: string;
  try {
    const user = await requireAdmin();
    userId = user.id;
  } catch {
    redirect("/admin/login");
  }
  const initial = await listTournamentsByOrganiser(userId);
  return <AdminDashboard initial={initial} />;
}

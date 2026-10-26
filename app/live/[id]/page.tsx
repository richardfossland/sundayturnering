import { permanentRedirect } from "next/navigation";

// «Følg turneringen» lives at /se/[id] now. /live/[id] is on printed QR codes
// and old links, so it stays and forwards (permanent: 308).
export default async function LivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/se/${encodeURIComponent(id)}`);
}

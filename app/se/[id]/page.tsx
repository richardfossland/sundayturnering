import { SpectatorClient } from "./SpectatorClient";

// Public, read-only spectator PHONE view. Shows live standings + current/next
// matches and big tap-to-react buttons that stream ephemeral cheers to the
// board over the existing Realtime channel. No DB write, no control code.
export default async function SpectatorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SpectatorClient id={id} />;
}

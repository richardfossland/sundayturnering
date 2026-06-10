import { BoardClient } from "@/app/board/[id]/BoardClient";

// Public, read-only spectator view. Same board, minus the referee control code.
export default async function LivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BoardClient id={id} spectator />;
}

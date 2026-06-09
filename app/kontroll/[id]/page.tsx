import { ControlClient } from "./ControlClient";

export default async function ControlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ControlClient id={id} />;
}

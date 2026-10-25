import { PrintClient } from "./PrintClient";

export default async function PrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PrintClient id={id} />;
}

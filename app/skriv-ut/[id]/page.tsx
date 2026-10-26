import { OrganiserHeader } from "@/lib/client/OrganiserHeader";
import { PrintClient } from "./PrintClient";

export default async function PrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <OrganiserHeader id={id} />
      <PrintClient id={id} />
    </>
  );
}

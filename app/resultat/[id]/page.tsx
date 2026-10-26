import { OrganiserHeader } from "@/lib/client/OrganiserHeader";
import { ResultClient } from "./ResultClient";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <OrganiserHeader id={id} />
      <ResultClient id={id} />
    </>
  );
}

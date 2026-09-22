import { OrganiserHub } from "./OrganiserHub";

export default async function OrganiserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrganiserHub id={id} />;
}

import { SiteHeader, backToHome } from "@/lib/client/SiteHeader";
import { OrganiserHub } from "./OrganiserHub";

export default async function OrganiserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <SiteHeader back={backToHome} />
      <OrganiserHub id={id} />
    </>
  );
}

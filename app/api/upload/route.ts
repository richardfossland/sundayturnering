import { ok, fail, rateLimit, clientIp } from "@/lib/server/http";
import { db } from "@/lib/server/store";

// POST /api/upload — team logo upload (multipart 'file'). Stores in the public
// 'team-logos' bucket and returns the public URL. Used by the wizard before the
// tournament row exists, so files land under a random path.
const MAX_BYTES = 2_000_000; // 2 MB
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export async function POST(req: Request) {
  if (!rateLimit(`upload:${clientIp(req)}`, 40, 60_000))
    return fail(429, "for_mange_forsok");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "ugyldig_form");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "mangler_fil");
  if (file.size > MAX_BYTES) return fail(413, "for_stor");
  if (!ALLOWED.includes(file.type)) return fail(415, "ugyldig_filtype");

  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await db()
    .storage.from("team-logos")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[upload]", error);
    return fail(500, "kunne_ikke_laste_opp");
  }

  const { data } = db().storage.from("team-logos").getPublicUrl(path);
  return ok({ url: data.publicUrl });
}

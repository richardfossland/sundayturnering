import { ok, fail, rateLimit, clientIp } from "@/lib/server/http";
import { db } from "@/lib/server/store";
import { sniffImage } from "@/lib/server/imageSniff";

// POST /api/upload — team logo upload (multipart 'file'). Stores in the public
// 'team-logos' bucket and returns the public URL. Used by the wizard before the
// tournament row exists, so files land under a random path.
//
// The file type is decided by its bytes (sniffImage), never by the declared
// MIME type or file name: raster only — an SVG could carry script and would be
// served publicly from the bucket.
const MAX_BYTES = 2_000_000; // 2 MB

export async function POST(req: Request) {
  if (!rateLimit(`upload:${clientIp(req)}`, 20, 60_000))
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
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return fail(415, "ugyldig_filtype");

  const path = `${crypto.randomUUID()}.${type.ext}`;

  const { error } = await db()
    .storage.from("team-logos")
    .upload(path, bytes, { contentType: type.mime, upsert: false });
  if (error) {
    console.error("[upload]", error);
    return fail(500, "kunne_ikke_laste_opp");
  }

  const { data } = db().storage.from("team-logos").getPublicUrl(path);
  return ok({ url: data.publicUrl });
}

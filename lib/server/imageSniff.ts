// Identify an uploaded logo by its leading bytes instead of trusting the
// client-declared MIME type. Only raster formats: an SVG can carry script and
// the bucket serves files publicly, so it would be stored XSS / free hosting.

export type LogoType = { mime: "image/png" | "image/jpeg" | "image/webp"; ext: string };

export function sniffImage(bytes: Uint8Array): LogoType | null {
  const b = bytes;
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  )
    return { mime: "image/png", ext: "png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { mime: "image/jpeg", ext: "jpg" };
  if (
    b.length >= 12 &&
    ascii(b, 0, 4) === "RIFF" &&
    ascii(b, 8, 12) === "WEBP"
  )
    return { mime: "image/webp", ext: "webp" };
  return null;
}

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to));
}

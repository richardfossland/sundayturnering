import { describe, it, expect } from "vitest";
import { sniffImage } from "@/lib/server/imageSniff";
import { sanitiseColour, sanitiseLogoUrl } from "@/lib/server/logo";
import { EMBLEM_COUNT, emblemDataUri } from "@/lib/emblems";
import { generateControlCode, generateWordCode, isValidControlCode } from "@/lib/codes";

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

describe("sniffImage — type by content, never by declared MIME", () => {
  it("recognises png / jpeg / webp", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))?.mime).toBe("image/png");
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))?.ext).toBe("jpg");
    expect(sniffImage(text("RIFF\x00\x00\x00\x00WEBPVP8 "))?.mime).toBe("image/webp");
  });
  it("rejects svg (script-capable), html and truncated files", () => {
    expect(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(text("<!doctype html><script>"))).toBeNull();
    expect(sniffImage(bytes(0x89, 0x50))).toBeNull();
  });
});

describe("sanitiseLogoUrl", () => {
  const SB = "https://abc.supabase.co";
  it("keeps every built-in emblem", () => {
    for (let i = 0; i < EMBLEM_COUNT; i++)
      expect(sanitiseLogoUrl(emblemDataUri(i), SB)).toBe(emblemDataUri(i));
  });
  it("keeps files from our own bucket", () => {
    const u = `${SB}/storage/v1/object/public/team-logos/5f0c-uuid.png`;
    expect(sanitiseLogoUrl(u, SB)).toBe(u);
  });
  it("drops third-party URLs, other buckets, path tricks and oversized data URIs", () => {
    expect(sanitiseLogoUrl("https://tracker.example/pixel.gif", SB)).toBeNull();
    expect(sanitiseLogoUrl(`${SB}/storage/v1/object/public/other/x.png`, SB)).toBeNull();
    expect(sanitiseLogoUrl(`${SB}/storage/v1/object/public/team-logos/../x.png`, SB)).toBeNull();
    expect(sanitiseLogoUrl(`${SB}.evil.com/storage/v1/object/public/team-logos/x.png`, SB)).toBeNull();
    expect(sanitiseLogoUrl("data:image/svg+xml," + "a".repeat(9000), SB)).toBeNull();
    expect(sanitiseLogoUrl("javascript:alert(1)", SB)).toBeNull();
    expect(sanitiseLogoUrl(42, SB)).toBeNull();
  });
});

describe("sanitiseColour", () => {
  it("accepts #rgb / #rrggbb only", () => {
    expect(sanitiseColour("#111")).toBe("#111");
    expect(sanitiseColour("#2e7cf6")).toBe("#2e7cf6");
    expect(sanitiseColour("red; background:url(x)")).toBe("#888888");
    expect(sanitiseColour(undefined)).toBe("#888888");
  });
});

describe("codes use the CSPRNG by default", () => {
  it("still produce the documented shapes", () => {
    for (let i = 0; i < 200; i++) {
      expect(isValidControlCode(generateControlCode())).toBe(true);
      expect(generateWordCode()).toMatch(/^[A-HJKMNP-Z]{4}-[A-HJKMNP-Z]{2}$/);
    }
  });
});

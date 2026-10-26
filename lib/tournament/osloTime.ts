/**
 * Veggklokke ↔ Europe/Oslo uten avhengighet av enhetens tidssone.
 * Skjemaet (datetime-local) har ingen sone; alle visninger er Oslo-tid, så
 * det brukeren taster inn tolkes som Oslo-tid uansett hvor enheten står.
 */

const FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Oslo",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Oslo-offset (ms, UTC → Oslo) på et gitt øyeblikk. */
function offsetMs(utcMs: number): number {
  const p: Record<string, number> = {};
  for (const part of FMT.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(utcMs / 1000) * 1000;
}

const RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY = 24 * 60 * 60 * 1000;

/**
 * "YYYY-MM-DDTHH:mm" (Oslo-veggklokke) → ISO-streng i UTC.
 * Høst-overlapp (kl. 02–03 forekommer to ganger) gir første forekomst
 * (sommertid); vår-hullet (02–03 finnes ikke) skyves frem til gyldig tid.
 * Ugyldig input gir "".
 */
export function osloLocalToIso(local: string): string {
  const m = RE.exec(local);
  if (!m) return "";
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(wall)) return "";
  const before = offsetMs(wall - DAY);
  const after = offsetMs(wall + DAY);
  const valid = [before, after]
    .map((o) => wall - o)
    .filter((t) => offsetMs(t) === wall - t);
  const utc = valid.length > 0 ? Math.min(...valid) : wall - before;
  return new Date(utc).toISOString();
}

/** ISO-øyeblikk → "YYYY-MM-DDTHH:mm" i Oslo-veggklokke. Ugyldig gir "". */
export function isoToOsloLocal(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + offsetMs(t)).toISOString().slice(0, 16);
}

/** Neste hele time i Oslo-tid, som datetime-local-verdi. */
export function nextOsloHourLocal(now: Date = new Date()): string {
  const t = now.getTime();
  const hour = 60 * 60 * 1000;
  return isoToOsloLocal(new Date(Math.floor(t / hour) * hour + hour).toISOString());
}

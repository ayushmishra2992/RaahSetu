import { crc32, deflateRawSync } from "node:zlib";

/**
 * Minimal ZIP writer for small in-memory document packs (no dependency, so no
 * transitive advisories). Supports UTF-8 names, DEFLATE or STORE per entry, and
 * archives up to 4 GiB / 65,535 entries (no ZIP64 — packs are a few MB).
 */
export interface ZipEntry {
  name: string;
  data: Buffer;
  date?: Date;
}

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** A safe archive path: forward slashes, no leading slash, no `..` segments. */
export function safeZipName(name: string) {
  const parts = name
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== "." && p !== "..");
  return parts.join("/").slice(0, 240) || "file";
}

export function createZip(entries: ZipEntry[]): Buffer {
  if (entries.length > 65_535) throw new Error("Too many ZIP entries");
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const used = new Set<string>();
  for (const e of entries) {
    let name = safeZipName(e.name);
    // De-duplicate names so no entry silently overwrites another on extraction.
    for (let n = 2; used.has(name.toLowerCase()); n++) name = name.replace(/(\.[^./]+)?$/, (ext) => ` (${n})${ext}`);
    used.add(name.toLowerCase());
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(e.data);
    const useDeflate = deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const crc = crc32(e.data) >>> 0;
    const { time, date } = dosDateTime(e.date ?? new Date());
    const flags = 0x0800; // UTF-8 file names
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

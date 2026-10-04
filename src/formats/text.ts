// Text resource decoders for LBX entries (observed layouts; see docs/research/formats/LBX.md).
//
// Fixed-record table:   u16 recordCount, u16 recordSize, then recordCount * recordSize bytes.
//                       Each record begins with a NUL-terminated string (bytes after the NUL are ignored).
// NUL-separated list:   a sequence of NUL-terminated strings (used for e.g. per-language name lists).

const DOS_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

/** Decode CP437-ish bytes; control characters other than tab/newline become spaces. */
export function decodeDosString(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    if (b === 0) break;
    if (b >= 128) s += DOS_HIGH[b - 128];
    else if (b < 32) s += b === 10 || b === 9 ? String.fromCharCode(b) : b === 8 ? "" : " ";
    else s += String.fromCharCode(b);
  }
  return s;
}

export function looksLikeRecordTable(e: Uint8Array): boolean {
  if (e.length < 4) return false;
  const count = e[0] | (e[1] << 8);
  const size = e[2] | (e[3] << 8);
  return count > 0 && size > 0 && size < 4096 && 4 + count * size === e.length;
}

export function decodeRecordTable(e: Uint8Array): string[] {
  if (!looksLikeRecordTable(e)) throw new Error("not a fixed-record string table");
  const count = e[0] | (e[1] << 8);
  const size = e[2] | (e[3] << 8);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(decodeDosString(e.subarray(4 + i * size, 4 + (i + 1) * size)));
  return out;
}

export function decodeNulList(e: Uint8Array): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < e.length; i++) {
    if (e[i] === 0) {
      out.push(decodeDosString(e.subarray(start, i)));
      start = i + 1;
    }
  }
  if (start < e.length) out.push(decodeDosString(e.subarray(start)));
  return out;
}

export function encodeRecordTable(strings: string[], size: number): Uint8Array {
  const out = new Uint8Array(4 + strings.length * size);
  out[0] = strings.length & 255;
  out[1] = strings.length >> 8;
  out[2] = size & 255;
  out[3] = size >> 8;
  strings.forEach((s, i) => {
    for (let k = 0; k < Math.min(s.length, size - 1); k++) out[4 + i * size + k] = s.charCodeAt(k) & 127;
  });
  return out;
}

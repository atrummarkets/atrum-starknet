/** Shared decoding. Kept in one place so the market list and a market page cannot disagree
 *  about what a phase number means. */
export type Phase = "Open" | "Revealing" | "Cleared" | "Resolved" | "Refunding";
export const PHASES: Phase[] = ["Open", "Revealing", "Cleared", "Resolved", "Refunding"];

/** ByteArray arrives as [word_count, ...words, pending_word, pending_len]. */
export function decodeByteArray(felts: string[]): string {
  const wordCount = Number(felts[0]);
  let out = "";
  for (let i = 1; i <= wordCount; i++) out += feltToAscii(felts[i], 31);
  const pendingLen = Number(felts[wordCount + 2] ?? 0);
  if (pendingLen > 0) out += feltToAscii(felts[wordCount + 1], pendingLen);
  return out;
}

function feltToAscii(felt: string, bytes: number): string {
  let hex = BigInt(felt).toString(16);
  if (hex.length % 2) hex = "0" + hex;
  hex = hex.padStart(bytes * 2, "0");
  let s = "";
  for (let i = 0; i < hex.length; i += 2) {
    const c = parseInt(hex.slice(i, i + 2), 16);
    if (c) s += String.fromCharCode(c);
  }
  return s;
}

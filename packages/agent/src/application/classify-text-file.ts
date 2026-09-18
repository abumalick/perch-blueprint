// Pure classification of raw file bytes for the read-only viewer. No I/O.
const SNIFF_BYTES = 8000;

export function classifyTextFile(
  bytes: Uint8Array,
  truncated: boolean,
): { binary: boolean; data: string } {
  if (isBinary(bytes, truncated)) return { binary: true, data: '' };
  return { binary: false, data: Buffer.from(bytes).toString('base64') };
}

function isBinary(bytes: Uint8Array, truncated: boolean): boolean {
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return true;
  if (decodes(bytes)) return false;
  // A capped read can slice the final UTF-8 char mid-sequence, so a decode failure on the
  // last few bytes is not evidence of binary — retry after dropping up to 3 trailing bytes.
  if (truncated) {
    for (let drop = 1; drop <= 3 && drop < bytes.length; drop += 1) {
      if (decodes(bytes.subarray(0, bytes.length - drop))) return false;
    }
  }
  return true;
}

function decodes(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

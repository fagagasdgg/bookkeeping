/** FNV-1a 32-bit hash, good enough for local fingerprints. */
export function hashText(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Normalize SMS sender for matching.
 * Handles +86, dual-SIM suffixes like 95588-1 / 95588(卡1), spaces, etc.
 */
export function normalizePhone(address: string): string {
  let s = (address || '').trim();
  // Strip common dual-SIM / slot markers before digit extraction
  s = s.replace(/[(（]\s*卡\s*[12]\s*[)）]/gi, '');
  s = s.replace(/[-_]?sim\s*[12]\b/gi, '');
  s = s.replace(/[-_][12]$/g, '');

  const digits = s.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('86')) {
    return digits.slice(2);
  }
  if (digits.length === 14 && digits.startsWith('086')) {
    return digits.slice(3);
  }
  // Keep short codes like 95588 intact
  if (digits.length >= 3) return digits;
  return s.toLowerCase();
}

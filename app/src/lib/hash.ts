/** FNV-1a 32-bit hash, good enough for local fingerprints. */
export function hashText(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function normalizePhone(address: string): string {
  const digits = address.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('86')) {
    return digits.slice(2);
  }
  if (digits.length === 14 && digits.startsWith('086')) {
    return digits.slice(3);
  }
  return digits || address.trim().toLowerCase();
}

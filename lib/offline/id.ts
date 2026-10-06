/** A lowercase UUID, the form storage object names need (public.storage_folder_uuid). */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type RandomSource = Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string };

/**
 * A random UUID v4. crypto.randomUUID only exists in secure contexts, and an
 * iPad reaches the dev server over plain http on the LAN, so this falls back
 * to getRandomValues, which every browser offers.
 */
export function newId(random: RandomSource = globalThis.crypto): string {
  if (typeof random.randomUUID === "function") return random.randomUUID().toLowerCase();
  const bytes = random.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

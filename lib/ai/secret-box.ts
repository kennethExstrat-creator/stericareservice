import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/*
 * Encrypts the API key an admin saves in Admin > AI Settings (AES-256-GCM).
 * The key is derived (HKDF-SHA256) from the server's SUPABASE_SECRET_KEY,
 * which the app already needs for the settings row, so no new variable is
 * involved; a database dump alone does not reveal the API key. If the
 * Supabase secret key is rotated, a saved key no longer opens and the
 * settings screen asks for it again.
 */

const VERSION = "v1";

function keyFrom(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "stericare-ai-settings", "anthropic-api-key", 32));
}

/** `v1.<iv>.<tag>.<ciphertext>`, base64url. */
export function sealSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** The plain text, or null when the box was sealed with another secret or is damaged. */
export function openSecret(sealed: string, secret: string): string | null {
  const [version, iv, tag, body, extra] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body || extra !== undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The secret the box key comes from, or null when the server has none. */
export function boxSecret(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  return env.SUPABASE_SECRET_KEY?.trim() || null;
}

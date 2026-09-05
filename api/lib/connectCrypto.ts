import crypto from "node:crypto";

/**
 * Token vault encryption — AES-256-GCM with a key derived from APP_SECRET.
 * Format: base64(iv | tag | ciphertext). Never store plaintext tokens.
 */

function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is required to encrypt connection tokens");
  return crypto.scryptSync(secret, "sanjeev-connect-v1", 32);
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptToken(packed: string): string {
  const raw = Buffer.from(packed, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

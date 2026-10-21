import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for per-user secrets (Google refresh tokens now,
 * myDATA credentials in phase (c)). The associated data binds a ciphertext to
 * its owner and purpose, so a value copied to another user's row fails to
 * decrypt. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) throw new Error("encryption key must be 32 bytes (base64)");
    this.key = key;
  }

  seal(plaintext: string, userId: string, purpose: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(aad(userId, purpose));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return ["v1", iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
  }

  open(sealed: string, userId: string, purpose: string): string {
    const [version, iv, tag, ct] = sealed.split(".");
    if (version !== "v1" || !iv || !tag || ct === undefined) throw new Error("unsupported ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAAD(aad(userId, purpose));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  }
}

function aad(userId: string, purpose: string): Buffer {
  return Buffer.from(`${userId}:${purpose}`, "utf8");
}

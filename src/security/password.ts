import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

/** scrypt cost; 2^17 with r=8 matches current OWASP guidance. Tests pass a lower value. */
export const DEFAULT_SCRYPT_LOG_N = 17;
export const MIN_PASSWORD_LENGTH = 10;

/** Hash format: scrypt$<logN>$<r>$<p>$<salt>$<hash> (base64url). */
export async function hashPassword(password: string, logN = DEFAULT_SCRYPT_LOG_N): Promise<string> {
  const salt = randomBytes(16);
  const N = 2 ** logN;
  const key = await scrypt(password.normalize("NFKC"), salt, 32, { N, r: 8, p: 1, maxmem: 256 * N * 8 });
  return ["scrypt", logN, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, logN, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !logN || !r || !p || !salt || !hash) return false;
  const N = 2 ** Number(logN);
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N,
    r: Number(r),
    p: Number(p),
    maxmem: 256 * N * Number(r),
  });
  return timingSafeEqual(key, expected);
}


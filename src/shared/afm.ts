/**
 * Validates a Greek tax number (ΑΦΜ): nine digits with the standard mod-11
 * check digit. This proves the number is well-formed, not that it is active;
 * activity checks against the AADE registry happen in the invoicing module.
 */
export function isValidAfm(input: string): boolean {
  const afm = input.replace(/\s+/g, "").replace(/^EL/i, "");
  if (!/^\d{9}$/.test(afm) || afm === "000000000") return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(afm[i]) * 2 ** (8 - i);
  }
  return (sum % 11) % 10 === Number(afm[8]);
}

export function normalizeAfm(input: string): string {
  return input.replace(/\s+/g, "").replace(/^EL/i, "");
}

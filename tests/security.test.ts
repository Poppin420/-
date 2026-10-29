import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SecretBox } from "../src/security/secretBox";
import { hashPassword, verifyPassword } from "../src/security/password";
import { matchClients, nameStems, type Client } from "../src/clients/clients";

describe("SecretBox (AES-256-GCM)", () => {
  const box = new SecretBox(randomBytes(32).toString("base64"));

  it("round-trips and uses a fresh IV each time", () => {
    const a = box.seal("refresh-token", "user-1", "google");
    const b = box.seal("refresh-token", "user-1", "google");
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh-token");
    expect(box.open(a, "user-1", "google")).toBe("refresh-token");
  });

  it("refuses ciphertext moved to another user or purpose", () => {
    const sealed = box.seal("secret", "user-1", "google");
    expect(() => box.open(sealed, "user-2", "google")).toThrow();
    expect(() => box.open(sealed, "user-1", "mydata")).toThrow();
  });

  it("detects tampering and wrong keys", () => {
    const sealed = box.seal("secret", "u", "p");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("xxxxxx").toString("base64url");
    expect(() => box.open(parts.join("."), "u", "p")).toThrow();
    expect(() => new SecretBox(randomBytes(32).toString("base64")).open(sealed, "u", "p")).toThrow();
  });

  it("requires a 32-byte key", () => {
    expect(() => new SecretBox(randomBytes(16).toString("base64"))).toThrow();
  });
});

describe("password hashing (scrypt)", () => {
  it("verifies the right password only", async () => {
    const hash = await hashPassword("σωστός κωδικός 123", 10);
    expect(hash.startsWith("scrypt$10$8$1$")).toBe(true);
    expect(await verifyPassword("σωστός κωδικός 123", hash)).toBe(true);
    expect(await verifyPassword("λάθος κωδικός 123", hash)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("client name matching", () => {
  const c = (name: string): Client => ({ id: name, name, nickname: null, plate: null, vat_number: null, phone: null, email: null });
  const clients = ["Μαρία Παπαδοπούλου", "Νίκος Αντωνίου", "Γιώργος Παπαδόπουλος", "Ελένη", "Alpha Software ΑΕ", "Κώστας Νικολάου"].map(c);

  it.each([
    ["Μαρία", ["Μαρία Παπαδοπούλου"]],
    ["Μαρίας", ["Μαρία Παπαδοπούλου"]],
    ["τη μαρια", ["Μαρία Παπαδοπούλου"]],
    ["Νίκο", ["Νίκος Αντωνίου"]],
    ["κ. Νίκου", ["Νίκος Αντωνίου"]],
    ["Γιώργο Παπαδόπουλο", ["Γιώργος Παπαδόπουλος"]],
    ["Ελένης", ["Ελένη"]],
    ["alpha software", ["Alpha Software ΑΕ"]],
    ["Κώστα", ["Κώστας Νικολάου"]],
    ["Δημήτρη", []],
  ])("%s -> %j", (spoken, expected) => {
    expect(matchClients(spoken, clients).map((x) => x.name)).toEqual(expected);
  });

  it("drops titles and keeps short stems", () => {
    expect(nameStems("κυρία Ζωή")).toEqual(["ζω"]);
  });

  it("matches a client by nickname as well as by official name", () => {
    const withNick: Client = { id: "g", name: "Γιώργος Παπαδόπουλος", nickname: "Γιώργος σίδερα", plate: null, vat_number: null, phone: null, email: null };
    const pool = [withNick, c("Γιώργος Αντωνίου")];
    // Spoken nickname finds exactly the client it belongs to, not the other Γιώργος.
    expect(matchClients("Γιώργος σίδερα", pool).map((x) => x.id)).toEqual(["g"]);
    // The official name still works.
    expect(matchClients("Παπαδόπουλο", pool).map((x) => x.id)).toEqual(["g"]);
  });
});

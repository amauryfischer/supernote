/**
 * @supernote/crypto — age-based encryption engine.
 *
 * Encrypts/decrypts arbitrary strings using the age-encryption library
 * with scrypt passphrase recipients. Output is armored (base64 wrapped in
 * age PEM headers) so encrypted files are recognisable text files on disk.
 *
 * The age-encryption v0.1.x API requires calling init() once to obtain
 * the { Encrypter, Decrypter } constructors.
 */

import ageInit from "age-encryption";

// ── Public interface ──────────────────────────────────────────────────────────

export interface EncryptionEngine {
  encrypt(plaintext: string, passphrase: string): Promise<string>;
  decrypt(ciphertext: string, passphrase: string): Promise<string>;
  isEncrypted(content: string): boolean;
}

// Age armored header — the spec guarantees this prefix.
const AGE_ARMOR_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----";
const AGE_ARMOR_FOOTER = "-----END AGE ENCRYPTED FILE-----";

// ── Lazy age module initialisation ────────────────────────────────────────────

type AgeModule = Awaited<ReturnType<typeof ageInit>>;
let _age: AgeModule | null = null;

async function getAge(): Promise<AgeModule> {
  if (!_age) _age = await ageInit();
  return _age;
}

// ── Base64 / armoring helpers ─────────────────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function armorEncode(raw: Uint8Array): string {
  const b64 = uint8ToBase64(raw);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return [AGE_ARMOR_HEADER, ...lines, AGE_ARMOR_FOOTER].join("\n");
}

function armorDecode(armored: string): Uint8Array {
  const body = armored
    .split("\n")
    .filter((l) => !l.startsWith("-----"))
    .join("");
  return base64ToUint8(body);
}

// ── Engine functions ──────────────────────────────────────────────────────────

async function encrypt(plaintext: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error("Passphrase must not be empty");
  const age = await getAge();
  const enc = new age.Encrypter();
  enc.setPassphrase(passphrase);
  const raw = enc.encrypt(plaintext);
  return armorEncode(raw);
}

async function decrypt(ciphertext: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error("Passphrase must not be empty");
  if (!isEncrypted(ciphertext)) {
    throw new Error("Content does not appear to be age-encrypted");
  }
  const raw = armorDecode(ciphertext.trim());
  const age = await getAge();
  const dec = new age.Decrypter();
  dec.addPassphrase(passphrase);
  return dec.decrypt(raw, "text");
}

function isEncrypted(content: string): boolean {
  return content.trimStart().startsWith(AGE_ARMOR_HEADER);
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createAgeEngine(): EncryptionEngine {
  return { encrypt, decrypt, isEncrypted };
}

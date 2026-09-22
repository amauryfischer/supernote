import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password, record) {
  const [saltHex, hashHex] = record.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

// Dernier saut de X-Forwarded-For : ajouté par le routeur, le client ne peut pas le falsifier.
export function clientIp(req) {
  const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops.at(-1) || req.socket?.remoteAddress || "";
}

// ponytail: compteur en mémoire, par conteneur et remis à zéro au redémarrage ;
// passer par un store si l'app tourne un jour sur plusieurs conteneurs.
export function createPasswordChecker() {
  const failures = new Map();
  // "ok" | "wrong" | "locked" : après MAX_FAILED_ATTEMPTS échecs d'une même adresse sur
  // une même portée, plus aucune vérification jusqu'à LOCKOUT_MS après le premier échec.
  return async function check(scope, req, provided, record) {
    const key = `${scope}\0${clientIp(req)}`;
    const now = Date.now();
    const entry = failures.get(key);
    if (entry && now - entry.since > LOCKOUT_MS) failures.delete(key);
    else if (entry && entry.count >= MAX_FAILED_ATTEMPTS) return "locked";
    // Réservée avant l'await : sinon N appels parallèles passent tous le test de verrouillage.
    const reserved = failures.get(key);
    if (reserved) reserved.count += 1;
    else failures.set(key, { count: 1, since: now });
    if (await verifyPassword(provided, record)) {
      failures.delete(key);
      return "ok";
    }
    if (failures.size > 10_000) {
      for (const [k, v] of failures) if (now - v.since > LOCKOUT_MS) failures.delete(k);
    }
    return "wrong";
  };
}

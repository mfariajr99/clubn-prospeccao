import crypto from "node:crypto";
import type { PasswordHasher } from "../accounts.js";

const KEY_LEN = 32;

/** scrypt with a random salt per password: "scrypt$<salt>$<hash>". */
export const nodePasswordHasher: PasswordHasher = {
  hash(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    return `scrypt$${salt}$${crypto.scryptSync(password, salt, KEY_LEN).toString("hex")}`;
  },
  verify(password, stored) {
    const [alg, salt, hash] = stored.split("$");
    if (alg !== "scrypt" || !salt || !hash) return false;
    const expected = Buffer.from(hash, "hex");
    const given = crypto.scryptSync(password, salt, KEY_LEN);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  },
};

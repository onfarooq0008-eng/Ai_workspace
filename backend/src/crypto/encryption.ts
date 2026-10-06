import * as crypto from "crypto";
import { config } from "../config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended for GCM

const key = Buffer.from(config.encryptionKey, "hex");

/**
 * Encrypts a plaintext string (e.g. an API key) for storage at rest.
 * Returns a single string: iv:authTag:ciphertext (all hex-encoded).
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, authTagHex, dataHex] = payload.split(":");
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error("Malformed encrypted payload");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Produces a masked display version of a secret, e.g. sk-************1234
 * Never send full keys to the client - use this everywhere a key is displayed.
 */
export function maskSecret(plaintext: string): string {
  if (!plaintext || plaintext.length < 8) return "****";
  const prefix = plaintext.slice(0, Math.min(3, plaintext.length - 4));
  const suffix = plaintext.slice(-4);
  const starCount = Math.max(8, plaintext.length - prefix.length - suffix.length);
  return `${prefix}${"*".repeat(starCount)}${suffix}`;
}

/**
 * Redacts likely secrets (API keys, bearer tokens, private keys, .env style values)
 * from arbitrary text before it is shown to a user or sent to another AI model.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{10,}/g, // OpenAI-style keys
  /Bearer\s+[a-zA-Z0-9._-]{10,}/gi,
  /(?:api[_-]?key|apikey|secret|token|password|passwd)\s*[:=]\s*["']?[^\s"'\n]{6,}["']?/gi,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

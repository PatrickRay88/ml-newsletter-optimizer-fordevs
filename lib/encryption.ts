import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createSecretKey,
  randomBytes,
  type KeyObject
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce for AES-GCM

function getKey(): KeyObject {
  const rawKey = process.env.APP_ENCRYPTION_KEY;

  if (!rawKey) {
    throw new Error("APP_ENCRYPTION_KEY is required for encrypting sensitive values");
  }

  const hash = createHash("sha256").update(rawKey).digest();
  return createSecretKey(hash as unknown as NodeJS.ArrayBufferView);
}

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function encryptSecret(secret: string): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv as unknown as NodeJS.ArrayBufferView);

  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8") as unknown as Uint8Array,
    cipher.final() as unknown as Uint8Array
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64")
  };
}

export function decryptSecret(payload: EncryptedPayload): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(payload.iv, "base64") as unknown as NodeJS.ArrayBufferView
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64") as unknown as NodeJS.ArrayBufferView);

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64") as unknown as NodeJS.ArrayBufferView) as unknown as Uint8Array,
    decipher.final() as unknown as Uint8Array
  ]);

  return plaintext.toString("utf8");
}

export function encryptionEnabled(): boolean {
  return Boolean(process.env.APP_ENCRYPTION_KEY && process.env.APP_ENCRYPTION_KEY.length > 0);
}

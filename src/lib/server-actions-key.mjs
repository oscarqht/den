import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SERVER_ACTIONS_KEY_DIR = ".den";
export const SERVER_ACTIONS_KEY_FILENAME = "server-actions-encryption-key";
const VALID_KEY_LENGTHS = new Set([16, 24, 32]);

function normalizeKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getServerActionsEncryptionKeyPath(appRoot) {
  return path.join(appRoot, SERVER_ACTIONS_KEY_DIR, SERVER_ACTIONS_KEY_FILENAME);
}

export function isValidServerActionsEncryptionKey(value) {
  const normalized = normalizeKey(value);
  if (!normalized) {
    return false;
  }

  try {
    const bytes = Buffer.from(normalized, "base64");
    return VALID_KEY_LENGTHS.has(bytes.length);
  } catch {
    return false;
  }
}

export function generateServerActionsEncryptionKey({ cryptoImpl = crypto } = {}) {
  return cryptoImpl.randomBytes(32).toString("base64");
}

export function ensureServerActionsEncryptionKey(
  env = process.env,
  { appRoot = process.cwd(), fsImpl = fs, cryptoImpl = crypto } = {},
) {
  const configuredKey = normalizeKey(env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY);
  if (configuredKey) {
    if (!isValidServerActionsEncryptionKey(configuredKey)) {
      throw new Error(
        "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY must decode to 16, 24, or 32 bytes of base64 data.",
      );
    }
    return configuredKey;
  }

  const keyPath = getServerActionsEncryptionKeyPath(appRoot);
  if (fsImpl.existsSync(keyPath)) {
    const storedKey = normalizeKey(fsImpl.readFileSync(keyPath, "utf8"));
    if (!isValidServerActionsEncryptionKey(storedKey)) {
      throw new Error(
        `Stored server actions key at ${keyPath} is invalid. Delete it and restart to regenerate.`,
      );
    }
    return storedKey;
  }

  fsImpl.mkdirSync(path.dirname(keyPath), { recursive: true });
  const generatedKey = generateServerActionsEncryptionKey({ cryptoImpl });
  fsImpl.writeFileSync(keyPath, `${generatedKey}\n`, { encoding: "utf8", mode: 0o600 });
  return generatedKey;
}

export function withServerActionsEncryptionKey(env = process.env, options = {}) {
  const key = ensureServerActionsEncryptionKey(env, options);
  return {
    ...env,
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: key,
  };
}

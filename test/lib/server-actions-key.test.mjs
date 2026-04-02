import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureServerActionsEncryptionKey,
  getServerActionsEncryptionKeyPath,
  isValidServerActionsEncryptionKey,
  withServerActionsEncryptionKey,
} from "../../src/lib/server-actions-key.mjs";

test("ensureServerActionsEncryptionKey creates and reuses a persisted key", () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "den-server-actions-key-"));

  try {
    const firstKey = ensureServerActionsEncryptionKey({}, { appRoot });
    const keyPath = getServerActionsEncryptionKeyPath(appRoot);

    assert.equal(isValidServerActionsEncryptionKey(firstKey), true);
    assert.equal(fs.existsSync(keyPath), true);
    assert.equal(fs.readFileSync(keyPath, "utf8").trim(), firstKey);

    const secondKey = ensureServerActionsEncryptionKey({}, { appRoot });
    assert.equal(secondKey, firstKey);
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});

test("withServerActionsEncryptionKey preserves an explicit valid environment key", () => {
  const explicitKey = Buffer.alloc(32, 7).toString("base64");
  const env = withServerActionsEncryptionKey(
    { NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: explicitKey, OTHER: "1" },
    { appRoot: process.cwd() },
  );

  assert.equal(env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, explicitKey);
  assert.equal(env.OTHER, "1");
});

test("ensureServerActionsEncryptionKey rejects invalid stored keys", () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "den-server-actions-key-invalid-"));

  try {
    const keyPath = getServerActionsEncryptionKeyPath(appRoot);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, "not-valid\n", "utf8");

    assert.throws(
      () => ensureServerActionsEncryptionKey({}, { appRoot }),
      /Stored server actions key/,
    );
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});

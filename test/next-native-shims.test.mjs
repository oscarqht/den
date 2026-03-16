import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { syncNextNativeShims } from "../src/lib/next-native-shims.mjs";

const tempDirs = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pal-next-shims-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("syncNextNativeShims", () => {
  it("replaces traced native binaries with the installed package runtime files", () => {
    const appRoot = makeTempDir();
    const tracedPackageRoot = path.join(
      appRoot,
      ".next",
      "server",
      "chunks",
      "node_modules",
      "better-sqlite3-deadbeef",
    );
    const installedPackageRoot = path.join(appRoot, "node_modules", "better-sqlite3");

    writeFile(path.join(tracedPackageRoot, "package.json"), JSON.stringify({ name: "better-sqlite3" }));
    writeFile(
      path.join(tracedPackageRoot, "build", "Release", "better_sqlite3.node"),
      "linux-binary",
    );
    writeFile(path.join(installedPackageRoot, "package.json"), JSON.stringify({ name: "better-sqlite3" }));
    writeFile(path.join(installedPackageRoot, "lib", "index.js"), "module.exports = {};");
    writeFile(
      path.join(installedPackageRoot, "build", "Release", "better_sqlite3.node"),
      "darwin-binary",
    );

    syncNextNativeShims(appRoot);

    assert.strictEqual(
      fs.readFileSync(path.join(tracedPackageRoot, "build", "Release", "better_sqlite3.node"), "utf8"),
      "darwin-binary",
    );
    assert.strictEqual(
      fs.readFileSync(path.join(tracedPackageRoot, "lib", "index.js"), "utf8"),
      "module.exports = {};",
    );
  });

  it("creates shim directories from .next/node_modules during postbuild sync", () => {
    const appRoot = makeTempDir();
    const sourcePackageRoot = path.join(appRoot, ".next", "node_modules", "keytar-deadbeef");
    const targetPackageRoot = path.join(
      appRoot,
      ".next",
      "server",
      "chunks",
      "node_modules",
      "keytar-deadbeef",
    );
    const installedPackageRoot = path.join(appRoot, "node_modules", "keytar");

    writeFile(path.join(sourcePackageRoot, "package.json"), JSON.stringify({ name: "keytar" }));
    writeFile(path.join(installedPackageRoot, "package.json"), JSON.stringify({ name: "keytar" }));
    writeFile(path.join(installedPackageRoot, "lib", "keytar.js"), "export default {};");
    writeFile(path.join(installedPackageRoot, "build", "Release", "keytar.node"), "native-keytar");

    syncNextNativeShims(appRoot);

    assert.strictEqual(
      fs.readFileSync(path.join(targetPackageRoot, "build", "Release", "keytar.node"), "utf8"),
      "native-keytar",
    );
    assert.strictEqual(
      fs.readFileSync(path.join(targetPackageRoot, "lib", "keytar.js"), "utf8"),
      "export default {};",
    );
  });
});

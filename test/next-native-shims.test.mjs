import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { syncNextNativeShims } from "../src/lib/next-native-shims.mjs";

const tempDirs = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "den-ai-next-shims-"));
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
  it("creates shim directories from .next/node_modules during postbuild sync", () => {
    const tempRoot = makeTempDir();
    const appRoot = path.join(tempRoot, "package");
    const sourcePackageRoot = path.join(appRoot, ".next", "node_modules", "keytar-deadbeef");
    const targetPackageRoot = path.join(
      appRoot,
      ".next",
      "server",
      "chunks",
      "node_modules",
      "keytar-deadbeef",
    );
    const installedPackageRoot = path.join(tempRoot, "node_modules", "keytar");

    writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "den-ai" }));
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

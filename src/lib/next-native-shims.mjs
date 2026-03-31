import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const RUNTIME_COPY_RULES = new Map([
  ["keytar", ["package.json", "lib", path.join("build", "Release")]],
]);
const require = createRequire(import.meta.url);

function copyIntoShim(sourceRoot, targetRoot, relativePath) {
  const sourcePath = path.join(sourceRoot, relativePath);
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  const targetPath = path.join(targetRoot, relativePath);
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });
    fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: true });
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function readPackageName(packageRoot) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return typeof packageJson.name === "string" ? packageJson.name : null;
  } catch {
    return null;
  }
}

function collectShimEntries({ appRoot, sourceDir, targetDir }) {
  if (fs.existsSync(sourceDir)) {
    return fs
      .readdirSync(sourceDir)
      .map((entryName) => {
        const sourcePackageRoot = fs.realpathSync(path.join(sourceDir, entryName));
        const packageName = readPackageName(sourcePackageRoot);
        if (!packageName) {
          return null;
        }

        return { entryName, packageName, fallbackSourceRoot: sourcePackageRoot };
      })
      .filter(Boolean);
  }

  if (!fs.existsSync(targetDir)) {
    return [];
  }

  return fs
    .readdirSync(targetDir)
    .map((entryName) => {
      const targetPackageRoot = path.join(targetDir, entryName);
      const packageName = readPackageName(targetPackageRoot);
      if (!packageName) {
        return null;
      }

      return { entryName, packageName, fallbackSourceRoot: path.join(appRoot, "node_modules", packageName) };
    })
    .filter(Boolean);
}

function resolveInstalledPackageRoot(packageName, appRoot) {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`, { paths: [appRoot] });
    return fs.realpathSync(path.dirname(packageJsonPath));
  } catch {
    return null;
  }
}

export function syncNextNativeShims(appRoot) {
  const sourceDir = path.join(appRoot, ".next", "node_modules");
  const targetDir = path.join(appRoot, ".next", "server", "chunks", "node_modules");
  const shimEntries = collectShimEntries({ appRoot, sourceDir, targetDir });

  if (shimEntries.length === 0) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  for (const shimEntry of shimEntries) {
    const runtimePaths = RUNTIME_COPY_RULES.get(shimEntry.packageName);
    if (!runtimePaths) {
      continue;
    }

    const sourcePackageRoot =
      resolveInstalledPackageRoot(shimEntry.packageName, appRoot) ?? shimEntry.fallbackSourceRoot;
    const targetPackageRoot = path.join(targetDir, shimEntry.entryName);

    for (const runtimePath of runtimePaths) {
      copyIntoShim(sourcePackageRoot, targetPackageRoot, runtimePath);
    }
  }
}

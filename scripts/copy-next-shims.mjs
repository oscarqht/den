import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const sourceDir = path.join(APP_ROOT, ".next", "node_modules");
const targetDir = path.join(APP_ROOT, ".next", "server", "chunks", "node_modules");

const RUNTIME_COPY_RULES = new Map([
  ["better-sqlite3", ["package.json", "lib", path.join("build", "Release")]],
  ["keytar", ["package.json", "lib", path.join("build", "Release")]],
]);

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

if (!fs.existsSync(sourceDir)) {
  process.exit(0);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

for (const shimEntry of fs.readdirSync(sourceDir)) {
  const shimSourcePath = fs.realpathSync(path.join(sourceDir, shimEntry));
  const packageJsonPath = path.join(shimSourcePath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    continue;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const runtimePaths = RUNTIME_COPY_RULES.get(packageJson.name) ?? ["package.json", "lib", path.join("build", "Release")];
  const shimTargetPath = path.join(targetDir, shimEntry);

  for (const runtimePath of runtimePaths) {
    copyIntoShim(shimSourcePath, shimTargetPath, runtimePath);
  }
}

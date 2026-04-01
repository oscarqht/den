import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

const QUOTED_CLASSNAME_PATTERN = /className="(?=[^"]*fixed inset-0)(?=[^"]*backdrop-blur-sm)([^"]+)"/g;
const TEMPLATE_CLASSNAME_PATTERN = /className=\{`(?=[^`]*fixed inset-0)(?=[^`]*backdrop-blur-sm)([^`]+)`\}/g;

type OverlayMatch = {
  className: string;
  filePath: string;
};

async function collectTsxFiles(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        return collectTsxFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith('.tsx') ? [entryPath] : [];
    }),
  );

  return files.flat();
}

function collectOverlayMatches(source: string, filePath: string): OverlayMatch[] {
  const matches: OverlayMatch[] = [];

  for (const pattern of [QUOTED_CLASSNAME_PATTERN, TEMPLATE_CLASSNAME_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      matches.push({
        className: match[1],
        filePath,
      });
    }
  }

  return matches;
}

describe('fullscreen blurred overlays', () => {
  it('use the shared dark backdrop token', async () => {
    const sourceRoot = path.join(process.cwd(), 'src');
    const tsxFiles = await collectTsxFiles(sourceRoot);
    const overlays: OverlayMatch[] = [];

    for (const filePath of tsxFiles) {
      const source = await fs.readFile(filePath, 'utf8');
      overlays.push(...collectOverlayMatches(source, filePath));
    }

    assert.ok(overlays.length > 0, 'Expected to find at least one fullscreen blurred overlay.');

    const offenders = overlays
      .filter(({ className }) => !className.includes('app-dark-overlay'))
      .map(({ className, filePath }) => `${path.relative(process.cwd(), filePath)} -> ${className}`);

    assert.deepEqual(offenders, []);
  });
});

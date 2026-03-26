import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isPathWithinDirectory } from './session-canvas-files.ts';

describe('session canvas path guards', () => {
  it('allows files inside the workspace root', () => {
    assert.equal(
      isPathWithinDirectory('/tmp/workspace', '/tmp/workspace/src/app.tsx'),
      true,
    );
  });

  it('rejects paths that escape the workspace root', () => {
    assert.equal(
      isPathWithinDirectory('/tmp/workspace', '/tmp/other/file.ts'),
      false,
    );
    assert.equal(
      isPathWithinDirectory('/tmp/workspace', '/tmp/workspace/../secrets.txt'),
      false,
    );
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PROJECT_ICON_PATH, getProjectIconUrl, hasProjectIcon } from './project-icons.ts';

describe('project-icons', () => {
  it('returns the bundled default icon when no icon is configured', () => {
    assert.equal(getProjectIconUrl(), DEFAULT_PROJECT_ICON_PATH);
  });

  it('returns a file-thumbnail URL for uploaded icons', () => {
    assert.equal(
      getProjectIconUrl({ iconPath: '/tmp/project icon.png', iconEmoji: null }),
      '/api/file-thumbnail?path=%2Ftmp%2Fproject%20icon.png',
    );
  });

  it('returns an inline svg data url for emoji icons', () => {
    const iconUrl = getProjectIconUrl({ iconPath: null, iconEmoji: '🚀' });
    assert.match(iconUrl, /^data:image\/svg\+xml;charset=utf-8,/);
    assert.match(decodeURIComponent(iconUrl), /🚀/);
  });

  it('recognizes both file and emoji icons as configured', () => {
    assert.equal(hasProjectIcon({ iconPath: '/tmp/icon.png', iconEmoji: null }), true);
    assert.equal(hasProjectIcon({ iconPath: null, iconEmoji: '🧠' }), true);
    assert.equal(hasProjectIcon({ iconPath: null, iconEmoji: null }), false);
  });
});

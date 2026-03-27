import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
    buildPreviewReloadUrl,
    PREVIEW_RELOAD_SEARCH_PARAM,
    shouldForcePreviewRemount,
} from './session-preview.ts';

describe('shouldForcePreviewRemount', () => {
    it('returns true when retrying the same loaded preview URL', () => {
        assert.equal(
            shouldForcePreviewRemount('http://127.0.0.1:43123/', 'http://127.0.0.1:43123/'),
            true,
        );
    });

    it('returns false when there is no active preview or the target changes', () => {
        assert.equal(shouldForcePreviewRemount('', 'http://127.0.0.1:43123/'), false);
        assert.equal(
            shouldForcePreviewRemount('http://127.0.0.1:43123/', 'http://127.0.0.1:43123/other'),
            false,
        );
    });

    it('ignores the internal reload nonce when comparing retry URLs', () => {
        const reloadedPreviewUrl = buildPreviewReloadUrl('http://127.0.0.1:43123/', 123);
        assert.equal(
            shouldForcePreviewRemount(reloadedPreviewUrl, 'http://127.0.0.1:43123/'),
            true,
        );
    });
});

describe('buildPreviewReloadUrl', () => {
    it('adds or replaces the internal reload nonce without changing the base preview URL', () => {
        const firstReloadUrl = buildPreviewReloadUrl('http://127.0.0.1:43123/', 123);
        const secondReloadUrl = buildPreviewReloadUrl(firstReloadUrl, 456);

        const firstParsed = new URL(firstReloadUrl);
        const secondParsed = new URL(secondReloadUrl);

        assert.equal(firstParsed.origin, 'http://127.0.0.1:43123');
        assert.equal(firstParsed.pathname, '/');
        assert.equal(firstParsed.searchParams.get(PREVIEW_RELOAD_SEARCH_PARAM), '123');
        assert.equal(secondParsed.searchParams.get(PREVIEW_RELOAD_SEARCH_PARAM), '456');
    });
});

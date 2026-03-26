import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isLocalHostname, isTailscaleHostname, normalizePreviewUrl } from './url.ts';

describe('isLocalHostname', () => {
    it('detects localhost and loopback hostnames', () => {
        assert.strictEqual(isLocalHostname('localhost'), true);
        assert.strictEqual(isLocalHostname('app.localhost'), true);
        assert.strictEqual(isLocalHostname('127.0.0.1'), true);
        assert.strictEqual(isLocalHostname('127.0.0.42:3200'), true);
        assert.strictEqual(isLocalHostname('::1'), true);
        assert.strictEqual(isLocalHostname('[::1]:3200'), true);
        assert.strictEqual(isLocalHostname('0.0.0.0'), true);
    });

    it('does not treat remote hosts as local', () => {
        assert.strictEqual(isLocalHostname('palx.nport.link'), false);
        assert.strictEqual(isLocalHostname('example.com'), false);
        assert.strictEqual(isLocalHostname('100.88.1.2'), false);
    });
});

describe('normalizePreviewUrl', () => {
    it('should return null for empty string', () => {
        assert.strictEqual(normalizePreviewUrl(''), null);
        assert.strictEqual(normalizePreviewUrl('   '), null);
    });

    it('should return null for non-http protocols', () => {
        assert.strictEqual(normalizePreviewUrl('ftp://example.com'), null);
        assert.strictEqual(normalizePreviewUrl('mailto:user@example.com'), null);
        assert.strictEqual(normalizePreviewUrl('javascript:alert(1)'), null);
        assert.strictEqual(normalizePreviewUrl('custom-scheme:abc'), null);
    });

    it('should return the original URL if it starts with http:// or https://', () => {
        assert.strictEqual(normalizePreviewUrl('http://example.com'), 'http://example.com');
        assert.strictEqual(normalizePreviewUrl('https://example.com'), 'https://example.com');
        assert.strictEqual(normalizePreviewUrl('  https://example.com  '), 'https://example.com');
    });

    it('should prepend https:// for non-local hosts when protocol is missing', () => {
        assert.strictEqual(normalizePreviewUrl('example.com'), 'https://example.com');
        assert.strictEqual(normalizePreviewUrl('example.com/docs'), 'https://example.com/docs');
    });

    it('should prepend http:// for localhost and loopback hosts when protocol is missing', () => {
        assert.strictEqual(normalizePreviewUrl('localhost:3000'), 'http://localhost:3000');
        assert.strictEqual(normalizePreviewUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
        assert.strictEqual(normalizePreviewUrl('app.localhost:3200'), 'http://app.localhost:3200');
    });
});

describe('isTailscaleHostname', () => {
    it('detects Tailscale MagicDNS names and IPs', () => {
        assert.strictEqual(isTailscaleHostname('office-mac.tail3158df.ts.net'), true);
        assert.strictEqual(isTailscaleHostname('100.88.1.2'), true);
        assert.strictEqual(isTailscaleHostname('100.127.255.254:3200'), true);
        assert.strictEqual(isTailscaleHostname('[fd7a:115c:a1e0::1234]:3200'), true);
    });

    it('does not treat unrelated hosts as Tailscale', () => {
        assert.strictEqual(isTailscaleHostname('localhost'), false);
        assert.strictEqual(isTailscaleHostname('palx.nport.link'), false);
        assert.strictEqual(isTailscaleHostname('100.63.0.1'), false);
        assert.strictEqual(isTailscaleHostname('100.128.0.1'), false);
    });
});

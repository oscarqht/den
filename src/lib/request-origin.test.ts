import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getRequestHostname, getRequestOrigin, isDirectLocalRequest } from './request-origin.ts';

function createHeaders(values: Record<string, string>): Pick<Headers, 'get'> {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

describe('getRequestHostname', () => {
  it('prefers x-forwarded-host over host and fallback', () => {
    const headers = createHeaders({
      'x-forwarded-host': 'palx.nport.link',
      host: 'localhost:3200',
    });

    assert.strictEqual(getRequestHostname(headers, '127.0.0.1'), 'palx.nport.link');
  });

  it('uses the first forwarded host value when multiple are present', () => {
    const headers = createHeaders({
      'x-forwarded-host': 'palx.nport.link, localhost:3200',
    });

    assert.strictEqual(getRequestHostname(headers), 'palx.nport.link');
  });

  it('falls back to host header and finally the provided hostname', () => {
    assert.strictEqual(getRequestHostname(createHeaders({ host: 'localhost:3200' })), 'localhost:3200');
    assert.strictEqual(getRequestHostname(createHeaders({}), '127.0.0.1'), '127.0.0.1');
  });
});

describe('getRequestOrigin', () => {
  it('builds the external origin from forwarded headers', () => {
    const headers = createHeaders({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'palx.nport.link',
    });

    assert.strictEqual(getRequestOrigin(headers, 'localhost:3200', 'http:'), 'https://palx.nport.link');
  });

  it('uses fallback protocol and hostname when forwarded headers are absent', () => {
    const headers = createHeaders({});

    assert.strictEqual(getRequestOrigin(headers, 'localhost:3200', 'http:'), 'http://localhost:3200');
  });
});

describe('isDirectLocalRequest', () => {
  it('treats plain localhost http requests as local', () => {
    const headers = createHeaders({ host: 'localhost:3200' });

    assert.strictEqual(isDirectLocalRequest(headers, 'localhost', 'http:'), true);
  });

  it('does not treat proxied https localhost requests as local', () => {
    const headers = createHeaders({
      host: 'localhost:3200',
      'x-forwarded-proto': 'https',
    });

    assert.strictEqual(isDirectLocalRequest(headers, 'localhost', 'http:'), false);
  });

  it('does not treat forwarded remote hosts as local', () => {
    const headers = createHeaders({
      host: 'localhost:3200',
      'x-forwarded-host': 'palx.nport.link',
      'x-forwarded-proto': 'https',
    });

    assert.strictEqual(isDirectLocalRequest(headers, 'localhost', 'http:'), false);
  });
});

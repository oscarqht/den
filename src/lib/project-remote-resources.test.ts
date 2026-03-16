import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getNotionDocumentLinks,
  normalizeNotionDocumentLink,
  normalizeNotionDocumentLinks,
  normalizeProjectRemoteResources,
  setNotionDocumentLinks,
} from './project-remote-resources.ts';

describe('normalizeNotionDocumentLink', () => {
  it('normalizes valid notion document links', () => {
    assert.equal(
      normalizeNotionDocumentLink(' https://workspace.notion.site/My-Doc-abc123/#top '),
      'https://workspace.notion.site/My-Doc-abc123',
    );
    assert.equal(
      normalizeNotionDocumentLink('https://www.notion.so/Engineering-Spec-1a2b3c4d5e6f7g8h9i0j/'),
      'https://www.notion.so/Engineering-Spec-1a2b3c4d5e6f7g8h9i0j',
    );
  });

  it('rejects non-notion links', () => {
    assert.equal(normalizeNotionDocumentLink('https://example.com/spec'), null);
    assert.equal(normalizeNotionDocumentLink('not-a-url'), null);
  });
});

describe('normalizeNotionDocumentLinks', () => {
  it('deduplicates normalized links and reports invalid entries', () => {
    const result = normalizeNotionDocumentLinks([
      'https://workspace.notion.site/Doc-1',
      ' https://workspace.notion.site/Doc-1/ ',
      'https://example.com/doc',
      'not-a-url',
    ]);

    assert.deepStrictEqual(result.links, ['https://workspace.notion.site/Doc-1']);
    assert.deepStrictEqual(result.invalidValues, ['https://example.com/doc', 'not-a-url']);
  });
});

describe('normalizeProjectRemoteResources', () => {
  it('normalizes and deduplicates remote resources', () => {
    const resources = normalizeProjectRemoteResources([
      {
        provider: 'notion',
        resourceType: 'document',
        uri: 'https://workspace.notion.site/Doc-1/',
      },
      {
        provider: 'notion',
        resourceType: 'document',
        uri: 'https://workspace.notion.site/Doc-1',
      },
      {
        provider: 'google_drive',
        resourceType: 'document',
        uri: 'https://drive.google.com/file/d/abc/view',
      },
      {
        provider: 'notion',
        resourceType: 'document',
        uri: 'https://example.com/not-notion',
      },
    ]);

    assert.deepStrictEqual(resources, [
      {
        provider: 'notion',
        resourceType: 'document',
        uri: 'https://workspace.notion.site/Doc-1',
      },
      {
        provider: 'google_drive',
        resourceType: 'document',
        uri: 'https://drive.google.com/file/d/abc/view',
      },
    ]);
  });

  it('replaces only notion document links when setNotionDocumentLinks is used', () => {
    const next = setNotionDocumentLinks([
      {
        provider: 'google_drive',
        resourceType: 'document',
        uri: 'https://drive.google.com/file/d/abc/view',
      },
      {
        provider: 'notion',
        resourceType: 'document',
        uri: 'https://workspace.notion.site/Old-Doc',
      },
    ], [
      'https://workspace.notion.site/New-Doc',
    ]);

    assert.deepStrictEqual(getNotionDocumentLinks(next), ['https://workspace.notion.site/New-Doc']);
    assert.deepStrictEqual(next, [
      {
        provider: 'google_drive',
        resourceType: 'document',
        uri: 'https://drive.google.com/file/d/abc/view',
      },
      {
        provider: 'notion',
        resourceType: 'document',
        uri: 'https://workspace.notion.site/New-Doc',
      },
    ]);
  });
});

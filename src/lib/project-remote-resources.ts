import type { ProjectRemoteResource } from './types';

export const NOTION_REMOTE_RESOURCE_PROVIDER = 'notion' as const;
export const DOCUMENT_REMOTE_RESOURCE_TYPE = 'document' as const;

const NOTION_HOST_SUFFIXES = ['notion.so', 'notion.site'] as const;

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeHttpUrl(rawValue: string): string | null {
  try {
    const parsed = new URL(rawValue.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeResourceProvider(value: unknown): string | null {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  return normalized || null;
}

function normalizeResourceType(value: unknown): string | null {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  return normalized || null;
}

function normalizeResourceUri(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  return normalizeHttpUrl(normalized) ?? normalized;
}

function isNotionHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return NOTION_HOST_SUFFIXES.some((suffix) => (
    normalized === suffix || normalized.endsWith(`.${suffix}`)
  ));
}

function isNotionDocumentResource(resource: ProjectRemoteResource): boolean {
  return resource.provider === NOTION_REMOTE_RESOURCE_PROVIDER
    && resource.resourceType === DOCUMENT_REMOTE_RESOURCE_TYPE;
}

function toResourceKey(resource: ProjectRemoteResource): string {
  return `${resource.provider}::${resource.resourceType}::${resource.uri}`;
}

export function normalizeNotionDocumentLink(rawValue: string): string | null {
  const normalizedUrl = normalizeHttpUrl(rawValue);
  if (!normalizedUrl) return null;

  try {
    const parsed = new URL(normalizedUrl);
    if (!isNotionHost(parsed.hostname)) return null;
    if (!parsed.pathname || parsed.pathname === '/') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeNotionDocumentLinks(rawValues: string[]): {
  links: string[];
  invalidValues: string[];
} {
  const links: string[] = [];
  const invalidValues: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of rawValues) {
    const trimmed = rawValue.trim();
    if (!trimmed) continue;

    const normalized = normalizeNotionDocumentLink(trimmed);
    if (!normalized) {
      invalidValues.push(trimmed);
      continue;
    }

    if (seen.has(normalized)) continue;
    seen.add(normalized);
    links.push(normalized);
  }

  return {
    links,
    invalidValues,
  };
}

export function buildNotionDocumentResources(links: string[]): ProjectRemoteResource[] {
  return normalizeNotionDocumentLinks(links).links.map((uri) => ({
    provider: NOTION_REMOTE_RESOURCE_PROVIDER,
    resourceType: DOCUMENT_REMOTE_RESOURCE_TYPE,
    uri,
  }));
}

export function normalizeProjectRemoteResources(value: unknown): ProjectRemoteResource[] {
  if (!Array.isArray(value)) return [];

  const resources: ProjectRemoteResource[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const provider = normalizeResourceProvider((entry as Record<string, unknown>).provider);
    const resourceType = normalizeResourceType((entry as Record<string, unknown>).resourceType);
    const uri = normalizeResourceUri((entry as Record<string, unknown>).uri);

    if (!provider || !resourceType || !uri) continue;

    const resource: ProjectRemoteResource = {
      provider,
      resourceType,
      uri,
    };

    if (provider === NOTION_REMOTE_RESOURCE_PROVIDER && resourceType === DOCUMENT_REMOTE_RESOURCE_TYPE) {
      const normalizedNotionUri = normalizeNotionDocumentLink(uri);
      if (!normalizedNotionUri) continue;
      resource.uri = normalizedNotionUri;
    }

    const title = normalizeOptionalText((entry as Record<string, unknown>).title);
    if (title) resource.title = title;

    const key = toResourceKey(resource);
    if (seen.has(key)) continue;
    seen.add(key);
    resources.push(resource);
  }

  return resources;
}

export function getNotionDocumentLinks(resources: ProjectRemoteResource[] | null | undefined): string[] {
  if (!resources || resources.length === 0) return [];
  return normalizeProjectRemoteResources(resources)
    .filter(isNotionDocumentResource)
    .map((resource) => resource.uri);
}

export function setNotionDocumentLinks(
  resources: ProjectRemoteResource[] | null | undefined,
  notionLinks: string[],
): ProjectRemoteResource[] {
  const normalizedResources = normalizeProjectRemoteResources(resources || []);
  const otherResources = normalizedResources.filter((resource) => !isNotionDocumentResource(resource));
  const notionResources = buildNotionDocumentResources(notionLinks);
  return [...otherResources, ...notionResources];
}

export function hasNotionDocumentResource(resources: ProjectRemoteResource[] | null | undefined): boolean {
  return getNotionDocumentLinks(resources).length > 0;
}

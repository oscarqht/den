import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_SESSION_COOKIE_NAME,
  getSessionSecret,
  isAuthEnabled,
  sanitizeNextPath,
} from '@/lib/auth/config';
import { verifyAuthSessionTokenEdge } from '@/lib/auth/session-token-edge';

function isPublicPath(pathname: string): boolean {
  if (pathname === '/login') return true;
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname === '/favicon.ico') return true;
  if (/\.[^/]+$/.test(pathname)) return true;
  return false;
}

function buildLoginRedirectUrl(request: NextRequest): URL {
  const loginUrl = new URL('/login', request.url);
  const nextPath = sanitizeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (nextPath) {
    loginUrl.searchParams.set('next', nextPath);
  }
  return loginUrl;
}

function createUnauthenticatedResponse(request: NextRequest, clearCookie: boolean): NextResponse {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const response = NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    if (clearCookie) {
      response.cookies.delete(AUTH_SESSION_COOKIE_NAME);
    }
    return response;
  }

  const response = NextResponse.redirect(buildLoginRedirectUrl(request));
  if (clearCookie) {
    response.cookies.delete(AUTH_SESSION_COOKIE_NAME);
  }
  return response;
}

async function isSessionStillAuthorized(request: NextRequest): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/auth/session', request.url), {
      method: 'GET',
      headers: {
        cookie: request.headers.get('cookie') ?? '',
      },
      cache: 'no-store',
    });

    if (!response.ok) return false;
    const data = await response.json() as { enabled?: boolean; authenticated?: boolean };

    if (data.enabled === false) {
      return true;
    }

    return Boolean(data.authenticated);
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return createUnauthenticatedResponse(request, false);
  }

  const payload = await verifyAuthSessionTokenEdge(token, getSessionSecret());
  if (!payload) {
    return createUnauthenticatedResponse(request, true);
  }

  const stillAuthorized = await isSessionStillAuthorized(request);
  if (!stillAuthorized) {
    return createUnauthenticatedResponse(request, true);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/:path*',
};

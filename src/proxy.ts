import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth0, isAuth0Configured, missingAuth0EnvVars } from '@/lib/auth0';
import { isDirectLocalRequest, isTrustedTailnetRequest } from '@/lib/request-origin';

const PUBLIC_FILE_PATH_PATTERN = /\.[^/]+$/;

function buildReturnTo(request: NextRequest): string {
  const { pathname, search } = request.nextUrl;
  return `${pathname}${search}`;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLocalRequest = isDirectLocalRequest(
    request.headers,
    request.nextUrl.hostname,
    request.nextUrl.protocol,
  );
  const isTailnetRequest = isTrustedTailnetRequest(
    request.headers,
    request.nextUrl.hostname,
  );
  const isAuthRoute = pathname === '/auth' || pathname.startsWith('/auth/');

  if (PUBLIC_FILE_PATH_PATTERN.test(pathname)) {
    return NextResponse.next();
  }

  if (isLocalRequest || isTailnetRequest) {
    if (isAuthRoute) {
      const returnTo = request.nextUrl.searchParams.get('returnTo');
      const destination = returnTo?.startsWith('/') ? returnTo : '/';
      return NextResponse.redirect(new URL(destination, request.url));
    }

    return NextResponse.next();
  }

  if (!isAuth0Configured || !auth0) {
    const message = `Authentication is required for non-local access, but Auth0 is not fully configured. Missing env vars: ${missingAuth0EnvVars.join(', ')}`;

    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: message }, { status: 503 });
    }

    return new NextResponse(message, {
      status: 503,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  const authResponse = await auth0.middleware(request);

  if (isAuthRoute) {
    return authResponse;
  }

  const session = await auth0.getSession(request);
  if (session) {
    return authResponse;
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const loginUrl = new URL('/auth/login', request.url);
  loginUrl.searchParams.set('returnTo', buildReturnTo(request));
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.[^/]+$).*)',
  ],
};

import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_SESSION_COOKIE_NAME,
  getSessionSecret,
  isAuthEnabled,
} from '@/lib/auth/config';
import { isEmailWhitelisted } from '@/lib/auth/email-whitelist';
import { verifyAuthSessionToken } from '@/lib/auth/session-token';

function createUnauthenticatedResponse(clearCookie: boolean) {
  const response = NextResponse.json({ enabled: true, authenticated: false, email: null });
  if (clearCookie) {
    response.cookies.delete(AUTH_SESSION_COOKIE_NAME);
  }
  return response;
}

export async function GET(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ enabled: false, authenticated: true, email: null });
  }

  const sessionToken = request.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json({ enabled: true, authenticated: false, email: null });
  }

  const payload = verifyAuthSessionToken(sessionToken, getSessionSecret());
  if (!payload) {
    return createUnauthenticatedResponse(true);
  }

  const isWhitelisted = await isEmailWhitelisted(payload.email);
  if (!isWhitelisted) {
    return createUnauthenticatedResponse(true);
  }

  return NextResponse.json({ enabled: true, authenticated: true, email: payload.email });
}

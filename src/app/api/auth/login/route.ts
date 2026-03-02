import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  AUTH_NEXT_COOKIE_NAME,
  AUTH_STATE_COOKIE_NAME,
  AUTH_STATE_COOKIE_TTL_SECONDS,
  getAuth0BaseUrl,
  getAuth0ClientId,
  getAuth0ClientSecret,
  getAuthCallbackUrl,
  isAuthEnabled,
  sanitizeNextPath,
} from '@/lib/auth/config';
import { isEmailWhitelisted } from '@/lib/auth/email-whitelist';

const requestSchema = z.object({
  email: z.string().email(),
  next: z.string().optional(),
});

function shouldUseSecureCookies(request: Request): boolean {
  return request.url.startsWith('https://') || process.env.NODE_ENV === 'production';
}

function mapAuth0LoginError(data: { error_description?: string; error?: string }): string {
  const errorDescription = (data.error_description || '').trim();
  const errorCode = (data.error || '').trim();
  const normalized = `${errorCode} ${errorDescription}`.toLowerCase();

  if (normalized.includes('connection is disabled')) {
    return 'Auth0 Passwordless Email connection is disabled. Enable it in Auth0 Dashboard (Authentication > Passwordless > Email) and allow this application.';
  }

  return errorDescription || errorCode || 'Failed to request magic link from Auth0.';
}

export async function POST(request: Request) {
  if (!isAuthEnabled()) {
    return NextResponse.json(
      { error: 'Auth0 email magic-link login is disabled because environment credentials are missing.' },
      { status: 400 },
    );
  }

  let parsedBody: z.infer<typeof requestSchema>;
  try {
    const body = await request.json();
    parsedBody = requestSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = parsedBody.email.trim().toLowerCase();
  const nextPath = sanitizeNextPath(parsedBody.next);

  const isWhitelisted = await isEmailWhitelisted(email);
  if (!isWhitelisted) {
    return NextResponse.json({ error: 'This email address is not in the whitelist.' }, { status: 403 });
  }

  const state = randomUUID();

  const auth0Response = await fetch(`${getAuth0BaseUrl()}/passwordless/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: getAuth0ClientId(),
      client_secret: getAuth0ClientSecret(),
      connection: 'email',
      email,
      send: 'link',
      authParams: {
        response_type: 'code',
        scope: 'openid profile email',
        redirect_uri: getAuthCallbackUrl(request),
        state,
      },
    }),
  });

  if (!auth0Response.ok) {
    let details = 'Failed to request magic link from Auth0.';

    try {
      const data = await auth0Response.json() as { error_description?: string; error?: string };
      details = mapAuth0LoginError(data);
    } catch {
      // Keep fallback message.
    }

    return NextResponse.json({ error: details }, { status: 502 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request),
    maxAge: AUTH_STATE_COOKIE_TTL_SECONDS,
    path: '/',
  });

  if (nextPath) {
    response.cookies.set(AUTH_NEXT_COOKIE_NAME, nextPath, {
      httpOnly: true,
      sameSite: 'lax',
      secure: shouldUseSecureCookies(request),
      maxAge: AUTH_STATE_COOKIE_TTL_SECONDS,
      path: '/',
    });
  } else {
    response.cookies.delete(AUTH_NEXT_COOKIE_NAME);
  }

  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createSessionToken,
  passwordsMatch,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";
import { checkRateLimit, requestFingerprint } from "@/lib/rate-limit";

const LoginSchema = z.object({ password: z.string().min(1).max(256) });

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length") || 0) > 2048) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }

  const fingerprint = requestFingerprint(request);
  const limit = checkRateLimit(`login:${fingerprint}`, 8, 15 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait and try again." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  try {
    const parsed = LoginSchema.safeParse(await request.json());
    if (!parsed.success || !passwordsMatch(parsed.data.password)) {
      return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions);
    return response;
  } catch {
    return NextResponse.json(
      { error: "The application is not configured correctly." },
      { status: 500 },
    );
  }
}

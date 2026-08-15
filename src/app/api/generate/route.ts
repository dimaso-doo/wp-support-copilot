import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { draftSupportReply } from "@/lib/openai";
import { checkRateLimit, requestFingerprint } from "@/lib/rate-limit";

export const runtime = "nodejs";

const GenerateSchema = z.object({
  customerMessage: z.string().trim().min(1).max(8000),
  history: z
    .array(
      z.object({
        customer: z.string().max(4000),
        reply: z.string().max(2000),
      }),
    )
    .max(12)
    .default([]),
});

export async function POST(request: NextRequest) {
  if (!verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  if (Number(request.headers.get("content-length") || 0) > 48 * 1024) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }

  const fingerprint = requestFingerprint(request);
  const limit = checkRateLimit(`generate:${fingerprint}`, 12, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "You are generating replies too quickly. Please wait a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  try {
    const parsed = GenerateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Please check the message and try again." },
        { status: 400 },
      );
    }

    const result = await draftSupportReply(parsed.data);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (reason) {
    console.error(
      "Reply generation failed:",
      reason instanceof Error ? reason.message : "Unknown server error",
    );
    return NextResponse.json(
      { error: "The reply could not be generated. Please try again." },
      { status: 500 },
    );
  }
}

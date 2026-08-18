import { NextRequest, NextResponse } from "next/server";
import { isValidEmail, joinWaitlist } from "@/lib/waitlist";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email } = (body ?? {}) as { email?: unknown };
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Enter a real email." }, { status: 400 });
  }

  try {
    const entry = await joinWaitlist(email);
    return NextResponse.json({ position: entry.position });
  } catch (err) {
    console.error("[strk20-waitlist] join failed:", err);
    return NextResponse.json(
      { error: "That did not go through. Try again." },
      { status: 500 }
    );
  }
}

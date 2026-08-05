import { NextResponse } from "next/server";

import { getNavigatorBootstrap } from "@/lib/index-navigator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getNavigatorBootstrap());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load index navigator." },
      { status: 400 },
    );
  }
}

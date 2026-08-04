import { NextResponse } from "next/server";

import { getNavigatorCatalog, getNavigatorResults } from "@/lib/index-navigator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const optionIds = url.searchParams.getAll("optionId").map((value) => value.trim()).filter(Boolean);
  const nodeQuery = url.searchParams.get("nodeQ")?.trim() ?? "";
  const requestedPage = Math.max(1, Number(url.searchParams.get("resultPage")) || 1);
  const pageSize = 50;

  try {
    const [categories, result] = await Promise.all([
      getNavigatorCatalog(),
      getNavigatorResults(optionIds, nodeQuery, requestedPage, pageSize),
    ]);
    return NextResponse.json({ categories, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load index navigator." },
      { status: 400 },
    );
  }
}

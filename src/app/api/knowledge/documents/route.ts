import { NextResponse } from "next/server";

import { getKnowledgeVersionReview, listKnowledgeDocuments, reconcileKnowledgeBindings } from "@/lib/knowledge-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const reviewVersionId = new URL(request.url).searchParams.get("reviewVersionId");
  if (reviewVersionId) {
    const review = getKnowledgeVersionReview(reviewVersionId);
    return review
      ? NextResponse.json({ review })
      : NextResponse.json({ error: "Knowledge version not found." }, { status: 404 });
  }
  await reconcileKnowledgeBindings();
  return NextResponse.json({ documents: listKnowledgeDocuments() });
}

import { backupDownloadResponse } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function HEAD(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return backupDownloadResponse(request, id, true);
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return backupDownloadResponse(request, id);
}

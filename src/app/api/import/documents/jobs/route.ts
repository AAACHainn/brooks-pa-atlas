import { NextResponse } from "next/server";

import { pdfImporter } from "@/lib/pdf-importer";
import { fileToBuffer } from "@/lib/storage";
import {
  serializeDocumentImportJob,
  startDocumentImportJob,
} from "@/lib/document-import-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const documentImporters = [pdfImporter];

function parseIndexPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((part): part is string => typeof part === "string")
      .map((part) => part.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseBooleanField(value: FormDataEntryValue | null) {
  return value === "true";
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Document file is required." }, { status: 400 });
  }

  const importer = documentImporters.find((candidate) => candidate.supports(file));
  if (!importer) {
    return NextResponse.json({ error: "Unsupported document type." }, { status: 400 });
  }

  const job = startDocumentImportJob({
    importer,
    file,
    buffer: await fileToBuffer(file),
    baseIndexPath: parseIndexPath(formData.get("baseIndexPath")),
    ocrEnabled: parseBooleanField(formData.get("ocrEnabled")),
  });

  return NextResponse.json({ job: serializeDocumentImportJob(job) });
}

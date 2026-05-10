export type DocumentImportInput = {
  file: File;
  buffer: Buffer;
  baseIndexPath: string[];
};

export type DocumentImportResult = {
  batchId: string;
  totalCount: number;
  imported: number;
  failed: number;
  duplicate: number;
  processedCount: number;
};

export type DocumentImporter = {
  kind: string;
  supports(file: File): boolean;
  importDocument(input: DocumentImportInput): Promise<DocumentImportResult>;
};

export type DocumentImportInput = {
  file: File;
  buffer: Buffer;
  baseIndexPath: string[];
  onProgress?: (progress: DocumentImportProgress) => void;
};

export type DocumentImportResult = {
  batchId: string;
  totalCount: number;
  imported: number;
  failed: number;
  duplicate: number;
  processedCount: number;
};

export type DocumentImportProgress = {
  batchId: string;
  totalCount: number;
  processedCount: number;
  imported: number;
  failed: number;
  duplicate: number;
};

export type DocumentImporter = {
  kind: string;
  supports(file: File): boolean;
  importDocument(input: DocumentImportInput): Promise<DocumentImportResult>;
};

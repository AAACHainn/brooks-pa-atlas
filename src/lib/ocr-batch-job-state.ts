export type OcrBatchJobTerminalStatus =
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "FAILED";

export const ocrBatchConfirmationPhrase = "确认重新OCR";

export function hasExistingOcrText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function ocrBatchTerminalStatus(
  completedImages: number,
  failedImages: number,
): OcrBatchJobTerminalStatus {
  if (failedImages === 0) return "COMPLETED";
  return completedImages === 0 ? "FAILED" : "COMPLETED_WITH_ERRORS";
}

export function ocrBatchProgressPercent(processedImages: number, totalImages: number) {
  if (totalImages <= 0) return 0;
  if (processedImages >= totalImages) return 100;
  return Math.min(99, Math.round((processedImages / totalImages) * 100));
}

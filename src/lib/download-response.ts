function encodeRfc5987Value(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function asciiFallbackFileName(fileName: string) {
  const fallback = fileName
    .replace(/[\r\n"\\]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return fallback || "download.zip";
}

export function attachmentContentDisposition(fileName: string) {
  return `attachment; filename="${asciiFallbackFileName(fileName)}"; filename*=UTF-8''${encodeRfc5987Value(
    fileName,
  )}`;
}

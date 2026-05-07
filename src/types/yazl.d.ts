declare module "yazl" {
  import type { Readable } from "node:stream";

  export class ZipFile {
    outputStream: Readable;
    addBuffer(buffer: Buffer, metadataPath: string, options?: { mtime?: Date; mode?: number }): void;
    addFile(realPath: string, metadataPath: string, options?: { mtime?: Date; mode?: number }): void;
    end(options?: { forceZip64Format?: boolean }): void;
  }
}

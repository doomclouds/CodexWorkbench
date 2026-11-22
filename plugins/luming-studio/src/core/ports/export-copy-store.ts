export interface ExportRecord {
  exportId: string;
  artifactId: string;
  filename: string;
  mimeType: string;
  size: number;
  downloadPath: string;
}
export interface ExportBytes {
  filename: string;
  mimeType: string;
  data: string;
  encoding?: 'base64' | 'utf8';
}

export interface StagedArchiveFile {
  filename: string;
  mimeType: string;
  size: number;
  chunks(): AsyncIterable<Uint8Array>;
  dispose(): Promise<void>;
}

export interface ExportStream extends ExportRecord {
  chunks(): AsyncIterable<Uint8Array>;
}

export interface ExportCopyStore {
  save(artifactId: string, result: ExportBytes | StagedArchiveFile): Promise<ExportRecord>;
  read(exportId: string): Promise<ExportRecord & { data: Uint8Array }>;
  open(exportId: string): Promise<ExportStream>;
  purge(artifactId: string): Promise<void>;
}

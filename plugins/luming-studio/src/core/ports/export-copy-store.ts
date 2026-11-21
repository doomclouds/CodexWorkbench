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
export interface ExportCopyStore {
  save(artifactId: string, result: ExportBytes): Promise<ExportRecord>;
  read(exportId: string): Promise<ExportRecord & { data: Uint8Array }>;
  purge(artifactId: string): Promise<void>;
}

export type AssetFileRead = { kind: 'data'; data: Uint8Array } | { kind: 'empty' | 'too-large' };

export interface ImportedAssetFile {
  filename: string;
  content: AssetFileRead;
}

export interface RecycledAssetFile {
  restore(): Promise<void>;
}

export interface AssetFileStore {
  readImport(path: string, maxBytes: number): Promise<ImportedAssetFile>;
  read(artifactId: string, assetId: string, maxBytes: number): Promise<AssetFileRead>;
  write(artifactId: string, assetId: string, data: Uint8Array): Promise<void>;
  recycle(artifactId: string, assetId: string): Promise<RecycledAssetFile | undefined>;
  duplicate(from: string, to: string): Promise<void>;
}

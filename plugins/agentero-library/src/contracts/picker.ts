export type FilePickerMode = 'open-file' | 'open-directory' | 'save-file';

export interface FilePickerFilter {
  name: string;
  /** Filename extensions without a leading dot or wildcard, for example pdf or exe. */
  extensions: string[];
}

export interface FilePickerInput {
  mode: FilePickerMode;
  title?: string;
  defaultPath?: string;
  /** Supported only for open-file. Directory and save selection are single-select. */
  multiple?: boolean;
  filters?: FilePickerFilter[];
}

export interface FilePickerResult {
  cancelled: boolean;
  /** Absolute local paths selected by the user. Empty when cancelled. */
  paths: string[];
}

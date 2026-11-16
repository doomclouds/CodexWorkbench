import type { Operation } from './studio.js';

export type FlowDirection = 'right' | 'down';
export interface FlowLabelSize { w: number; h: number }
export interface FlowLayoutPreview {
  requestId: string; artifactId: string; revision: number; direction: FlowDirection; gap: number;
  operations: Operation[]; expectedVersions: Record<string, number>;
  affectedIds: string[]; boundaryIds: string[];
  skipped: { ids: string[]; reason: string }[]; warnings: string[];
}

/** Product-neutral operations; product adapters validate their own fields. */
export interface ProposalOperation { op: string; [key: string]: unknown }
export interface ProposalChange { id: string; before: unknown; after: unknown }
export interface ProposalOption {
  id: string;
  label: string;
  description?: string;
  operations: ProposalOperation[];
  baselineRevision: number;
  versions: Record<string, number>;
  baseline: Record<string, unknown>;
  wholeContent: boolean;
  targetIds: string[];
  active: boolean;
  application?: { historyId: string; revision: number; changes: ProposalChange[] };
}
export interface Proposal {
  audience: 'owner';
  expiresAt: string;
  options: ProposalOption[];
  creationId?: string;
  fingerprint: string;
  receipts: { id: string; fingerprint: string; historyId?: string }[];
}

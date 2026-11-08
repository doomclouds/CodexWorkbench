import type { LibrarySettings, LibraryStatus, Paper } from '../contracts/types';

export const previewSettings: LibrarySettings = {
  schemaVersion: 1, cliPath: 'agentero', vaultPath: '', pdfiumPath: '', allowAgentPdfText: false, vaultId: 'preview',
};

export const previewStatus: LibraryStatus = {
  ready: false, capabilityScope: 'service-support', instanceId: 'preview', dataRoot: '~/.codexworkbench/agentero-library/',
  defaultVaultPath: '~/.codexworkbench/agentero-library/vault',
  cli: { available: false, supported: false, path: '', version: null },
  vault: { configured: false, valid: false, vaultId: 'preview', path: '', name: '界面预览' },
  capabilities: { metadata: false, notes: false, pdfRead: false, pdfText: false, pdfParse: false, layout: false },
  pdfium: { configured: false, available: false, path: '', diagnostic: '预览未检测本机环境' },
  allowAgentPdfText: false, activeOperations: 0, recoveryDrafts: 0,
};

export const previewPapers: Paper[] = [
  { id: 'react', path: 'papers/preview-react', title: 'ReAct: Synergizing Reasoning and Acting in Language Models', authors: ['Yao et al.'], year: 2022, tags: ['Agent', '示例'], isRead: false },
  { id: 'reflexion', path: 'papers/preview-reflexion', title: 'Reflexion: Language Agents with Verbal Reinforcement Learning', authors: ['Shinn et al.'], year: 2023, tags: ['反馈', '示例'], isRead: true },
  { id: 'memory', path: 'papers/preview-memory', title: 'MemGPT: Towards LLMs as Operating Systems', authors: ['Packer et al.'], year: 2023, tags: ['记忆', '示例'], isRead: false },
];

import type {
  ActiveBoardGuest,
  BoardIdentity,
  BrowserSession,
  GuestRole,
  Invitation,
  ShareSettings,
  SharingMember,
  SharingReceipt,
  SharingScope,
} from '../domain/index.js';

export type {
  BoardIdentity,
  BrowserSession,
  GuestRole,
  Invitation,
  ShareSettings,
  SharingMember,
  SharingReceipt,
} from '../domain/index.js';

export interface StoredSharingReceipt {
  readonly signature: string;
  readonly receipt: SharingReceipt;
}

export interface SharingReader {
  activeSharingScopes(): readonly SharingScope[];
  getBoard(boardId: string): BoardIdentity | undefined;
  ownsBoard(boardId: string, actorId: string): boolean;
  getSettings(boardId: string): ShareSettings | undefined;
  listInvitations(boardId: string): readonly Invitation[];
  listMembers(boardId: string): readonly SharingMember[];
  getMember(boardId: string, actorId: string): SharingMember | undefined;
  getInvitation(boardId: string, role: GuestRole): Invitation | undefined;
  findMemberByName(boardId: string, nameKey: string): SharingMember | undefined;
  getBrowserSession(tokenHash: string): BrowserSession | undefined;
  getActiveGuest(boardId: string, actorId: string, now: number): ActiveBoardGuest | undefined;
  actorSessionIsActive(actorId: string, now: number): boolean;
  getReceipt(boardId: string, actorId: string, commandId: string): StoredSharingReceipt | undefined;
}

export interface SharingWriter extends SharingReader {
  saveSettings(boardId: string, settings: ShareSettings): void;
  saveInvitation(boardId: string, invitation: Invitation): void;
  saveMember(boardId: string, member: SharingMember): void;
  deleteMember(boardId: string, actorId: string): void;
  saveBrowserSession(tokenHash: string, session: BrowserSession): void;
  saveReceipt(actorId: string, stored: StoredSharingReceipt): void;
}

export interface SharingRepository {
  read<T>(work: (reader: SharingReader) => T): T;
  write<T>(work: (writer: SharingWriter) => T): T;
}

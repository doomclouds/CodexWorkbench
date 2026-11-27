import type { InvitationRole, SharingRejection, SharingScope } from '../../data/sharing/index.js';

export const invitationRoles = ['editor', 'commenter', 'viewer'] as const;

export const roleLabels: Record<InvitationRole, string> = {
  editor: '可编辑',
  commenter: '可评论',
  viewer: '仅查看',
};

export const roleDescriptions: Record<InvitationRole, string> = {
  editor: '编辑和评论',
  commenter: '评论，不能编辑',
  viewer: '只能查看',
};

export const scopeLabels: Record<SharingScope, string> = {
  local: '仅这台电脑',
  lan: '局域网可访问',
};

export const rejectionMessages: Record<SharingRejection, string> = {
  forbidden: '你当前没有管理此白板分享的权限。',
  versionChanged: '分享设置已更新，请核对后重试。',
  commandIdReuse: '此操作和原回执不一致，请核对当前设置后重试。',
  invalidCommand: '无法应用这项分享设置。',
  lanUnavailable: '暂时无法开启局域网分享。',
  invitationUnavailable: '这个邀请链接已经失效。',
  nameTaken: '这个名字已有人使用。',
  memberUnavailable: '找不到此成员，请重新读取。',
  roleDisabled: '这个角色的邀请已停用。',
};

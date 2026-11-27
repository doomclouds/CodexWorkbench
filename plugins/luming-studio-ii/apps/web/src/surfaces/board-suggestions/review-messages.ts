import type { SuggestionReviewReceipt } from '../../data/suggestions/index.js';

type Rejection = Extract<SuggestionReviewReceipt, { kind: 'rejected' }>['reason'];

const rejectionMessages: Readonly<Record<Rejection, string>> = {
  forbidden: '当前身份没有审阅此建议的权限。',
  invalidEdit: '此方案无法按当前白板内容应用。',
  objectNotFound: '此方案中的一个对象已不存在。',
  geometryLocked: '此方案会修改已锁定的对象。',
  commandIdReuse: '原命令与保存记录不一致。请刷新建议。',
  unsupportedKind: '此方案包含当前未支持的操作。',
  versionUnavailable: '建议的来源版次已不可用。',
  tooLarge: '建议涉及的内容超过处理上限。',
  invalidImage: '建议依赖的图片已不可用。',
  invalidVideo: '建议依赖的视频已不可用。',
  unknown: '服务拒绝了此操作。',
};

export const reviewConflict = '白板或建议已更新。请重新读取并核对方案。';

export function rejectionMessage(reason: Rejection): string {
  return rejectionMessages[reason];
}

export function requestFailure(failure: unknown, fallback: string): string {
  return failure instanceof Error && failure.message ? fallback + ' ' + failure.message : fallback;
}

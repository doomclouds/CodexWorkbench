/** Original vector stickers shared by the picker, live canvas and offline exports. */
export interface BoardSticker { id: string; label: string; keywords: string; body: string }
const yellow = '#f5c75e', orange = '#e99662', red = '#e87970', blue = '#8eb5dc', green = '#b3c894', pink = '#e9a9c7', purple = '#bab0da';
const path = (d: string, fill = 'none') => `<path d="${d}" fill="${fill}"/>`;
const circle = (cx: number, cy: number, r: number, fill: string) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const rect = (x: number, y: number, w: number, h: number, fill: string, rx = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
const sticker = (id: string, label: string, keywords: string, body: string): BoardSticker => ({ id, label, keywords, body });

export const BOARD_STICKERS: readonly BoardSticker[] = [
  sticker('smile', '笑脸', 'smile happy 开心 表情', circle(12, 12, 9, yellow) + path('M7 10q1-3 3 0m4 0q1-3 3 0M7 13h10q-1 6-5 6t-5-6Z', '#fff1be')),
  sticker('plus', '加号', 'plus add 添加 正向', path('M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z', green)),
  sticker('thumbs-up', '赞同', 'thumbs up agree good like 赞 点赞', path('M8 10c3-1 4-4 5-7 3 0 3 3 1 6h5q3 0 2 3l-2 8H8ZM3 10h5v10H3Z', yellow) + path('M16 12h5m-6 4h5')),
  sticker('thumbs-down', '不赞同', 'thumbs down disagree 不同意 反对', path('M8 14c3 1 4 4 5 7 3 0 3-3 1-6h5q3 0 2-3l-2-8H8ZM3 4h5v10H3Z', yellow) + path('M16 12h5m-6-4h5')),
  sticker('heart', '爱心', 'heart love 喜欢 关心', path('M12 21C8 18 3 14 3 9 3 3 9 2 12 7c3-5 9-4 9 2 0 5-5 9-9 12Z', red)),
  sticker('wave', '挥手', 'wave hand hello 你好 招呼', path('m7 20-3-8q0-2 2-1l2 3-2-8q0-2 2-1l2 7V4q1-2 2 0v8l2-7q2-1 2 1l-1 7 2-4q2-1 2 1l-2 8q-3 5-10 2Z', yellow) + path('M3 5 5 3m14 1 2 2M2 8H1')),
  sticker('clap', '鼓掌', 'clap applause hands 支持 拍手', path('M4 20V9q1-2 2 0v5-8q1-2 2 0v7-9q1-2 2 0v9-7q1-2 2 0v9l2-3q2-1 2 1l-3 7Z', yellow) + path('m14 20 4-7V7q2-2 2 0v13ZM5 2 4 1m10 2 1-2m6 3 1-1', '#f7d98b')),
  sticker('handshake', '握手', 'handshake agree partnership 合作 共识', path('m2 9 5-5 5 2 5-2 5 5-4 7-5 4-8-5Z', yellow) + path('m8 9 4-3 4 3q0 3-3 2l-2-1-3 3m1 4 2-2m1 4 2-2m1 0 2-2')),
  sticker('heart-hand', '用心支持', 'care heart support 关怀 感谢', path('M11 12C7 10 5 8 5 5q2-4 6 0 4-4 6 0 1 3-6 7Z', red) + path('M3 15h4l4 2h6q2-1 1-3l3-1q2 4-3 7H6l-3 1Z', pink)),
  sticker('bulb', '想法', 'lightbulb idea insight 灵感 点子', path('M8 16c0-3-4-4-3-8 1-7 13-7 14 0 1 4-3 5-3 8ZM8 17h8v4H8Z', '#f8dda0') + path('m10 15-1-6 3 2 3-2-1 6M9 19h6')),
  sticker('question', '问题', 'question help why 疑问 帮助', circle(12, 12, 9, purple) + path('M9 8q0-4 4-3 5 2 0 6-2 1-1 4m0 3h.1')),
  sticker('alert', '提醒', 'alert warning caution 注意 风险 警告', path('M12 3 22 21H2Z', yellow) + path('M12 8v6') + circle(12, 17.5, .65, '#273443')),
  sticker('check', '完成', 'check done yes success 成功 通过 对勾', rect(4, 4, 16, 16, green, 2) + path('m7 11 4 4L22 5')),
  sticker('cross', '取消', 'cross no cancel stop 拒绝 错误 关闭', circle(12, 12, 9, red) + path('m8 8 8 8m0-8-8 8')),
  sticker('flag', '旗帜', 'flag milestone mark 里程碑 标记', path('M5 21V3m1 1h15l-4 6 4 5H6Z', red) + circle(5, 3, 1.5, '#f7eee7')),
  sticker('bolt', '闪电', 'bolt lightning zap fast 快速 能量', path('m14 2-11 12h7l-1 8L22 9h-8Z', yellow)),
  sticker('pin', '地点', 'pin location map 定位 位置', path('M12 22C8 16 4 13 4 9a8 8 0 0 1 16 0c0 4-4 7-8 13Z', red) + circle(12, 9, 3, '#f4aa9f')),
  sticker('search', '发现', 'search find discover 搜索 查找 放大镜', circle(9, 9, 6.5, blue) + path('m14 13 8 7-3 3-7-8Z', '#b9d5ec')),
  sticker('key', '钥匙', 'key access important 关键 权限', path('M14 11a6 6 0 1 0-5 4v6h4v-3h3v-3h-3Z', yellow) + circle(8, 8, 2.5, '#f8e1aa')),
  sticker('party', '庆祝', 'party celebrate confetti 彩带 祝贺', path('M4 21 7 7l10 10Z', pink) + path('m11 5 2-3m4 7 4-1m-7 5 5-6m1 9 3 2M7 3l1 1') + circle(18, 3, 1, yellow) + circle(22, 12, 1, blue)),
  sticker('trophy', '奖杯', 'trophy win award 冠军 奖励', path('M7 3h10v9q-1 5-5 5t-5-5Zm3 14h4v3h-4ZM7 21h10M7 5H3q0 8 5 7M17 5h4q0 8-5 7', yellow)),
  sticker('crown', '皇冠', 'crown royal best 第一 优秀', path('M5 20 3 7l6 5 3-9 3 9 6-5-2 13Z', yellow) + circle(3, 6, 1.4, '#f8e1aa') + circle(12, 3, 1.4, '#f8e1aa') + circle(21, 6, 1.4, '#f8e1aa')),
  sticker('gift', '礼物', 'gift present thanks 赠礼 惊喜', rect(4, 10, 16, 11, red) + rect(3, 7, 18, 4, '#f2a79b') + path('M12 7v14M12 7C3 8 4 1 8 3l4 4Zm0 0c9 1 8-6 4-4Z', '#f1b1bd')),
  sticker('clock', '时钟', 'clock time deadline 时间 截止', circle(12, 12, 9, blue) + path('M12 6v7h5')),
  sticker('calendar', '日历', 'calendar date plan 日期 计划', rect(3, 5, 18, 16, red, 2) + path('M3 10h18M8 3v5m8-5v5M8 10v11m8-11v11M3 15h18')),
  sticker('hourglass', '沙漏', 'hourglass wait patience 等待 倒计时', path('M5 3h14c0 6-2 6-5 9 3 3 5 3 5 9H5c0-6 2-6 5-9-3-3-5-3-5-9Z', '#f9e8ba') + path('M6 6h12l-6 5Zm0 13 6-6 6 6Z', yellow) + path('M4 2h16M4 22h16')),
  sticker('messages', '讨论', 'messages chat discuss 对话 沟通', path('M14 17H7l-4 3v-7a7 7 0 1 1 11 4Z', blue) + path('M14 10q8-2 8 5v7l-4-2q-7 1-8-5Z', '#aecbe5')),
  sticker('megaphone', '公告', 'megaphone announce broadcast 宣布 通知', path('m3 10 13-6v16L3 14Zm3 5 2 6h4l-2-7Z', orange) + path('M18 8q4 4 0 8m2-10q6 6 0 12')),
  sticker('pencil', '铅笔', 'pencil edit write 编辑 书写', path('m4 15 11-12q2-2 5 1t1 4L9 20l-7 2Z', yellow) + path('m14 4 6 6M4 15l5 5m-6 1 2-5') + path('m3 22 5-1 4 1 3-2 4 1 3-2')),
  sticker('chart', '增长图表', 'chart growth graph mountain 数据 进展', path('M3 21V4h3v14h15v3Z', purple) + path('m7 15 4-5 4 2 6-8v14H7Z', green) + path('m16 4 5-1 1 5')),
  sticker('trending-up', '向上趋势', 'trending up progress improve 提升 趋势', path('M3 21V13h5v-4h5V5h6V2l4 5-4 5V9h-3v5h-5v4H7v3Z', purple)),
  sticker('send', '纸飞机', 'send paper plane launch 发送 出发', path('M2 8 22 2l-6 20-5-8Z', blue) + path('m3 8 8 6L22 2M11 14l-1 7 6-5')),
  sticker('sun', '太阳', 'sun bright day 阳光 明亮', path('m12 1 2 5 4-3-1 5 5 1-4 4 4 3-5 1 1 5-5-3-3 4-1-5-5 1 3-5-4-3 5-1-1-5 5 3Z', '#f7dc8a') + circle(12, 12, 4.5, yellow)),
  sticker('sprout', '萌芽', 'sprout plant grow 新芽 成长', path('M12 22V11M12 13C1 13 1 3 6 5c6 0 6 8 6 8Zm0-2C12 0 23 1 22 6c-1 6-10 5-10 5Z', green) + path('M5 22h14')),
  sticker('flower', '花朵', 'flower bloom beauty 鲜花 绽放', path('M12 22V9m0 8q-9 0-9-6 7-1 9 6Zm0 3q9-1 9-7-7-1-9 7Z', green) + path('M12 3q4-4 5 1 5-1 3 4 2 4-4 4-3 4-5-1-6 0-4-4-3-4 1-5Z', pink) + circle(13, 6.5, 2, '#f6d58a')),
  sticker('coffee', '咖啡', 'coffee break cup 休息 咖啡杯', path('M4 8h13v9q-1 4-6 4t-7-4Zm13 1h3q4 5-3 7Z', '#c8a589') + path('M2 22h18M7 5q-2-2 0-4m5 4q-2-2 0-4')),
  sticker('piggy-bank', '储蓄罐', 'piggy bank save money 存钱 预算', path('M6 7q-2-5 3-3l2 2q9-2 9 5l3 1v5l-4 1v4h-4v-3H9v3H5v-5Q0 15 3 10L1 8q3-2 5-1Z', pink) + path('M10 8h5') + circle(18, 11, .6, '#273443')),
  sticker('arrow-right', '向右', 'arrow right next forward 下一步 前进', path('M3 9h11V3l8 9-8 9v-6H3Z', blue)),
  sticker('arrow-up', '向上', 'arrow up top 上升 顶部', path('M9 22V11H3l9-9 9 9h-6v11Z', green)),
  sticker('repeat', '循环', 'repeat loop cycle 迭代 循环', path('M5 9q1-7 10-5l2-2v6h-6l2-2q-5-1-6 4ZM19 15q-1 7-10 5l-2 2v-6h6l-2 2q5 1 6-4Z', green)),
  sticker('target', '目标', 'target aim focus 专注 靶心', circle(12, 12, 9, red) + circle(12, 12, 6, '#f9e8db') + circle(12, 12, 3, red) + path('m12 12 9-9m-5 0h5v5')),
  sticker('rocket', '火箭', 'rocket launch release 发布 启动', path('M9 16 5 19l-1-7 4-3m7 6 0 5-6 1 3-4', orange) + path('M7 15Q7 3 21 2q1 13-11 15Z', blue) + circle(15, 8, 2.5, '#dcebf5') + path('m7 17-4 4 5-1', yellow)),
];

const byId = new Map(BOARD_STICKERS.map(value => [value.id, value]));
export function getBoardSticker(id: unknown): BoardSticker | undefined { return typeof id === 'string' ? byId.get(id) : undefined; }
/** Only fixed catalog markup is rendered; an unknown stored ID falls back to legacy text. */
export function boardStickerMarkup(id: unknown): string | undefined {
  const value = getBoardSticker(id);
  if (!value) return undefined;
  return `<g stroke-linecap="round" stroke-linejoin="round"><g stroke="#ffffff" stroke-width="4">${value.body}</g><g stroke="#273443" stroke-width="1.3">${value.body}</g></g>`;
}

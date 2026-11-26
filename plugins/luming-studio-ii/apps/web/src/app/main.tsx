import { createRoot } from 'react-dom/client';
import { createWhiteboardService } from '../data/whiteboard/index.js';
import { createCommandId, postProtobuf, readBoardId } from '../platform/browser/index.js';
import { WhiteboardApp } from './index.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('缺少白板页面挂载点。');
}

const service = createWhiteboardService(postProtobuf);
createRoot(container).render(
  <WhiteboardApp boardId={readBoardId()} service={service} createCommandId={createCommandId} />,
);

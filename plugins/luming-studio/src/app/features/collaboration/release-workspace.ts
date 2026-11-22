import {
  STUDIO_TOOLS,
  type AgentTaskReleaseTarget,
  type StudioClient,
} from '../../../contracts/studio';
import type { StudioViewRequests } from '../../shared/studio-view-scope';

export async function releaseWorkspace(
  client: StudioClient,
  scope: StudioViewRequests,
  target: AgentTaskReleaseTarget,
  allowed: boolean,
) {
  const request = scope.capture();
  if (!allowed || target.artifactId !== request.artifactId || !scope.isCurrent(request)) {
    throw new Error('当前界面不能结束此工作区。');
  }

  await client.call(STUDIO_TOOLS.activity, { action: 'release', ...target });
}

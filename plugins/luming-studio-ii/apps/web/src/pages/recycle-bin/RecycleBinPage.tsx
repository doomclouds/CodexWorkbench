import {
  RecycleBinSurface,
  type RecycleBinSurfaceProps,
} from '../../surfaces/recycle-bin/index.js';

export function RecycleBinPage({
  management,
  createCommandId,
  onBack,
  preferences,
}: RecycleBinSurfaceProps) {
  return (
    <RecycleBinSurface
      management={management}
      createCommandId={createCommandId}
      onBack={onBack}
      preferences={preferences}
    />
  );
}

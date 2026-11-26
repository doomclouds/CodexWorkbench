import { WorkbenchSurface, type WorkbenchSurfaceProps } from '../../surfaces/workbench/index.js';

export type WorkbenchPageProps = WorkbenchSurfaceProps;

export function WorkbenchPage(props: WorkbenchPageProps) {
  return <WorkbenchSurface {...props} />;
}

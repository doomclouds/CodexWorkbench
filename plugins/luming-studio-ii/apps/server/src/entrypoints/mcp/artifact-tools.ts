import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerArtifactExportTool } from './artifact-export-tool.js';
import {
  registerArtifactFeedbackTool,
  type FeedbackToolOptions,
} from './artifact-feedback-tool.js';
import { registerArtifactManageTool } from './artifact-manage-tool.js';
import { registerArtifactShareTool } from './artifact-share-tool.js';

export function registerArtifactTools(server: McpServer, options: FeedbackToolOptions): void {
  registerArtifactManageTool(server, options);
  registerArtifactFeedbackTool(server, options);
  registerArtifactShareTool(server, options);
  registerArtifactExportTool(server, options);
}

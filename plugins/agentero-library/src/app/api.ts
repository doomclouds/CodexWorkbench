import { callTool as bridgeCallTool } from './bridge';
import { codeOf } from './model';

export const VAULT_CHANGED_EVENT = 'agentero-library:vault-changed';

export async function callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  try { return await bridgeCallTool<T>(name, args); }
  catch (error) {
    if (codeOf(error) === 'VAULT_CHANGED') window.dispatchEvent(new Event(VAULT_CHANGED_EVENT));
    throw error;
  }
}

import type { StudioClient } from '../contracts/studio';

/** Browser pages use HTTP; an embedded app uses its host-owned RPC transport. */
export async function studioRequest(client: StudioClient, input: string | URL, init?: RequestInit): Promise<Response> {
  if (client.request) return client.request(input, init);
  return fetch(input, init);
}

export async function downloadStudioFile(client: StudioClient, path: string, filename: string): Promise<void> {
  const url = new URL(path, client.baseUrl || location.href);
  const response = await studioRequest(client, url, { headers: client.token ? { Authorization: `Bearer ${client.token}` } : {} });
  if (!response.ok) throw new Error(`作品导出读取失败（${response.status}）。`);
  await downloadStudioBlob(client, await response.blob(), filename);
}

export async function downloadStudioBlob(client: StudioClient, blob: Blob, filename: string): Promise<void> {
  if (client.downloadFile) { await client.downloadFile(blob, filename); return; }
  if (client.embedded) throw new Error('当前宿主未提供文件下载能力，请更新宿主或在浏览器中导出。');
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = objectUrl; link.download = filename; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

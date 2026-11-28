import { captureScriptedRuntime } from './vector-scripted-runtime.js';

interface ScriptedRegion {
  readonly html: string;
  readonly width: number;
  readonly height: number;
}

const maxBytes = 16 * 1024 * 1024;
const pngPrefix = 'data:image/png;base64,';
const capturePolicy =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";

function relayFrame(source: string, id: string, width: number, height: number, maxLength: number) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = `border:0;display:block;width:${width}px;height:${height}px`;

  function relay(event: MessageEvent<unknown>) {
    if (event.origin !== 'null' || event.source !== frame.contentWindow) {
      return;
    }

    const result = event.data;
    const hasId = result !== null && typeof result === 'object' && 'id' in result;
    if (!hasId || result.id !== id) {
      return;
    }

    if ('png' in result && typeof result.png === 'string' && result.png.length <= maxLength) {
      window.parent.postMessage({ id, png: result.png }, '*');
    } else if ('failed' in result && result.failed === true) {
      window.parent.postMessage(
        { id, failed: true, blocked: 'blocked' in result && result.blocked === true },
        '*',
      );
    }
  }

  window.addEventListener('message', relay);
  frame.srcdoc = source;
  document.body.append(frame);
}

function safeScriptArgument(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function captureDocument(html: string, id: string, width: number, height: number) {
  const script = `(${captureScriptedRuntime.toString()})(${safeScriptArgument({ id, width, height, maxBytes })})`;
  const small = html.replace(/^\s*<!doctype[^>]*>/iu, '');
  const source = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${capturePolicy}"><script>${script}</script>${small}`;
  const relay = `(${relayFrame.toString()})(${safeScriptArgument(source)},${safeScriptArgument(id)},${width},${height},${maxBytes})`;

  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${capturePolicy}"><body style="margin:0;overflow:hidden"><script>${relay}</script></body>`;
}

function safePng(value: string, width: number, height: number) {
  if (value.length > maxBytes || !value.startsWith(pngPrefix)) {
    return false;
  }

  const data = value.slice(pngPrefix.length);
  if (data.length < 32 || data.length % 4 || !/^[a-z\d+/]+={0,2}$/iu.test(data)) {
    return false;
  }

  const bytes = Uint8Array.from(atob(data.slice(0, 32)), (char) => char.charCodeAt(0));
  const header = new DataView(bytes.buffer);

  return (
    header.getUint32(0) === 0x89504e47 &&
    header.getUint32(4) === 0x0d0a1a0a &&
    header.getUint32(8) === 13 &&
    header.getUint32(12) === 0x49484452 &&
    header.getUint32(16) === width &&
    header.getUint32(20) === height
  );
}

export function captureScriptedRaster(
  frame: HTMLIFrameElement,
  region: ScriptedRegion,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const width = Math.ceil(region.width);
  const height = Math.ceil(region.height);
  const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) =>
    part.toString(16),
  ).join('-');

  return new Promise((resolve, reject) => {
    function cleanup() {
      signal.removeEventListener('abort', abort);
      window.removeEventListener('message', receive);
    }

    function abort() {
      cleanup();
      reject(signal.reason);
    }

    function receive(event: MessageEvent<unknown>) {
      if (event.origin !== 'null' || event.source !== frame.contentWindow) {
        return;
      }

      const result = event.data;
      const hasId = result !== null && typeof result === 'object' && 'id' in result;
      if (!hasId || result.id !== id) {
        return;
      }

      cleanup();
      if ('png' in result && typeof result.png === 'string' && safePng(result.png, width, height)) {
        resolve(result.png);
      } else {
        const blocked = 'blocked' in result && result.blocked === true;
        reject(new Error(blocked ? '无法读取图解内受限的图片像素。' : '无法导出图解的画面。'));
      }
    }

    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    try {
      frame.srcdoc = captureDocument(region.html, id, width, height);
      document.body.append(frame);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

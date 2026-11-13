import { readFile } from 'node:fs/promises';

/** Keep favicon bytes inline before Vite turns the source href into an asset URL. */
export function inlineLibraryFaviconPlugin(iconPath) {
  const sourceHref = 'href="../../assets/icon64.png"';
  return {
    name: 'inline-library-favicon',
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        if (html.split(sourceHref).length !== 2) throw new Error('Expected exactly one library favicon source href.');
        const bytes = await readFile(iconPath);
        return html.replace(sourceHref, `href="data:image/png;base64,${bytes.toString('base64')}"`);
      },
    },
  };
}

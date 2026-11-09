/** Protocol payloads can contain document bytes. Keep production error reporting. */
export function sdkProtocolDebugPlugin(transformScript) {
  return {
    name: 'strip-sdk-protocol-debug',
    async transform(code, id) {
      const path = id.split('?')[0].replaceAll('\\', '/');
      const sdk = path.includes('/@modelcontextprotocol/ext-apps/') || path.includes('/@openai/mcp-extensions/');
      if (!sdk || !/\.m?js$/.test(path) || !code.includes('console.debug')) return null;
      const result = await transformScript(code, { loader: 'js', target: 'es2023', pure: ['console.debug'], minifySyntax: true, sourcemap: false });
      return { code: result.code, map: null };
    },
  };
}

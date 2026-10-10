import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const identity = (): Plugin => ({
  name: 'mechanism-build-identity', apply: 'build',
  async writeBundle(options, bundle) {
    const modules = [...this.getModuleIds()].filter(id => !id.startsWith('\0')).map(id => relative(root, id).replaceAll('\\', '/')).sort();
    if (modules.some(id => /maplibre|pmtiles|(?:gl|canvas)-map|spatial-overlay|research-semantic\/catalogue/.test(id))) throw new Error('NON_MAP_DEPENDENCY_VIOLATION');
    const assets = Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b)).map(([path, entry]) => {
      const content = entry.type === 'chunk' ? entry.code : entry.source;
      const bytes = typeof content === 'string' ? Buffer.from(content) : content;
      if (path.endsWith('.js') && /GEMINI_API_KEY|generativelanguage\.googleapis\.com|x-goog-api-key/.test(String(content))) throw new Error('NODE_PROVIDER_IN_BROWSER');
      return { path, bytes: bytes.length, sha256: sha256(bytes) };
    });
    const build = { schemaVersion: 1, buildId: 'mechanism-' + sha256(JSON.stringify(assets)), modules, assets, mapDependencies: false, nodeProviderBundled: false };
    await writeFile(new URL('./dist/build-info.json', import.meta.url), JSON.stringify(build, null, 2) + '\n');
  },
});
export default defineConfig({ base: './', plugins: [identity()], server: { host: '127.0.0.1', port: 4174, strictPort: true, fs: { allow: [root], deny: ['**/.env', '**/.env.*', '**/gem.env', '**/*.{crt,pem}', '**/.git/**'] } } });

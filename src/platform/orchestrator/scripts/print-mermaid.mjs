// Prints the compiled default workflow as a Mermaid diagram.
//   node src/platform/orchestrator/scripts/print-mermaid.mjs            print it
//   node src/platform/orchestrator/scripts/print-mermaid.mjs --write    refresh default-workflow.mmd
// Options: --approve=backend,screens   --steps=security:backend,style:screens
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const arg = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1];

const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', resolve: { alias: { '@': path.join(root, 'src') } }, optimizeDeps: { noDiscovery: true } });
try {
  const { diagram } = await server.ssrLoadModule(path.join(here, '../diagram.ts'));
  const approvals = (arg('approve') || '').split(',').filter(Boolean);
  const steps = (arg('steps') || '').split(',').filter(Boolean).map((x) => { const [id, after] = x.split(':'); return { id, name: id, after, mode: 'advise' }; });
  const text = diagram({ approvals, steps });
  if (process.argv.includes('--write')) writeFileSync(path.join(here, '../default-workflow.mmd'), text);
  else process.stdout.write(text);
} finally {
  await server.close();
}

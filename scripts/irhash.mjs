#!/usr/bin/env node
/**
 * Print the IR fingerprint to put in a spec as `// @ir-hash <value>`.
 *
 *   node scripts/irhash.mjs ID-4 ID-2     -> one line per id
 *   node scripts/irhash.mjs               -> every ir/*.json
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { irHash } from './lib/irhash.mjs';

function main() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'ir');
  const ids = process.argv.slice(2).length
    ? process.argv.slice(2)
    : readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'schema.json').map((f) => f.replace(/\.json$/, '')).sort();
  let bad = 0;
  for (const id of ids) {
    const p = join(dir, `${id}.json`);
    if (!existsSync(p)) { console.error(`✖ ir/${id}.json not found`); bad++; continue; }
    console.log(`${id} ${irHash(JSON.parse(readFileSync(p, 'utf8')))}`);
  }
  if (bad) process.exit(1);
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();

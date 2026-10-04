import { readFileSync } from 'node:fs';
import { runOffline } from './offline.mjs';
const request = JSON.parse(readFileSync(new URL('./examples/evaluate.json', import.meta.url), 'utf8'));
console.log(JSON.stringify(await runOffline(request), null, 2));

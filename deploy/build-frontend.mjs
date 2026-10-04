import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../workflow/web/', import.meta.url));
const output = fileURLToPath(new URL('../dist/', import.meta.url));
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });
console.log('Built the workflow web assets in dist/.');

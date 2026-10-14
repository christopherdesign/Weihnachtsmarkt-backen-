import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..');
const source = resolve(project, '..');
const target = resolve(project, 'web');
const files = ['index.html', 'style.css', 'app1.txt', 'app2.txt', 'app3.txt', 'app4.txt', 'app5.txt'];

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await Promise.all(files.map(file => copyFile(resolve(source, file), resolve(target, file))));
console.log(`V10.5-Webdateien nach ${target} kopiert.`);

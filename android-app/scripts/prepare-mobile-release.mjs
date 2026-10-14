import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..', '..');
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  throw new Error('Versionsnummer im Format 10.5.0 angeben.');
}

const target = resolve(project, 'mobile-releases', version);
const files = ['index.html', 'style.css', 'app1.txt', 'app2.txt', 'app3.txt', 'app4.txt', 'app5.txt'];
await mkdir(target, { recursive: true });
await Promise.all(files.map(file => copyFile(resolve(project, file), resolve(target, file))));
console.log(`Mobile-Release ${version} wurde unter ${target} vorbereitet.`);

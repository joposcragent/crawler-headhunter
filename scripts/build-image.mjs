import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const imageName = process.env.DOCKER_IMAGE_NAME ?? pkg.name;
const imageVersion = process.env.DOCKER_IMAGE_VERSION ?? pkg.version;
const ref = `${imageName}:${imageVersion}`;

console.log(`[build:image] docker build -t ${ref} .`);

const result = spawnSync('docker', ['build', '-t', ref, '.'], {
  cwd: root,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const latestRef = `${imageName}:latest`;
console.log(`[build:image] docker tag ${ref} ${latestRef}`);

const tagResult = spawnSync('docker', ['tag', ref, latestRef], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(tagResult.status === 0 ? 0 : tagResult.status ?? 1);

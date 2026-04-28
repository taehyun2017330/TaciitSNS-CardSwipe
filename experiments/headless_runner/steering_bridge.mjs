#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const repoRoot = path.resolve(currentDir, '../..');
const frontendDir = path.join(repoRoot, 'frontend');
const cacheDir = path.join(repoRoot, 'experiments', '.cache');
const entryPoint = path.join(currentDir, 'steering_bridge_entry.ts');
const bundlePath = path.join(cacheDir, 'steering_bridge_bundle.mjs');

function requireEsbuild() {
  const frontendRequire = createRequire(path.join(frontendDir, 'package.json'));
  try {
    return frontendRequire('esbuild');
  } catch (error) {
    throw new Error('Unable to load esbuild. Run `npm install` in frontend/ before using the steering bridge.');
  }
}

async function buildBundle() {
  fs.mkdirSync(cacheDir, { recursive: true });
  const esbuild = requireEsbuild();
  await esbuild.build({
    entryPoints: [entryPoint],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    define: {
      'import.meta.env': '{}'
    },
    logLevel: 'silent'
  });
}

await buildBundle();
const bridge = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

for await (const line of rl) {
  if (!line.trim()) {
    continue;
  }
  let id = null;
  try {
    const request = JSON.parse(line);
    id = request.id ?? null;
    const result = await bridge.handle(request);
    process.stdout.write(JSON.stringify({ id, ok: true, result }) + '\n');
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }) + '\n'
    );
  }
}


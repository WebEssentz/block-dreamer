const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const www = path.join(root, 'www');
const lib = path.join(www, 'lib');

if (!fs.existsSync(www)) fs.mkdirSync(www, { recursive: true });
if (!fs.existsSync(lib)) fs.mkdirSync(lib, { recursive: true });

// Copy ONNX Runtime Web WASM files for 100% offline play
const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const ortFiles = [
  'ort.min.js',
  'ort.all.min.js',
  'ort.wasm.min.js',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm'
];

for (const f of ortFiles) {
  const src = path.join(ortDist, f);
  const dst = path.join(lib, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log(`Copied ${f} to www/lib/`);
  } else {
    console.warn(`Warning: ${src} not found`);
  }
}

// Update version.json
try {
  const { execSync } = require('child_process');
  let commit = '';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch (_) {}
  const verData = {
    version: '1.0.1',
    commit: commit || 'latest',
    timestamp: Date.now(),
    releaseUrl: 'https://github.com/WebEssentz/block-dreamer/releases/tag/latest-apk',
    apkUrl: 'https://github.com/WebEssentz/block-dreamer/releases/download/latest-apk/app-debug.apk'
  };
  fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify(verData, null, 2));
} catch (e) {
  console.warn('Could not auto-generate version.json', e.message);
}

// Copy game root files
const gameFiles = [
  'index.html',
  'style.css',
  'app.js',
  'engine.js',
  'ai-worker.js',
  'updater.js',
  'version.json',
  'model.onnx',
  'model.json',
  'me.jpg'
];

for (const f of gameFiles) {
  const src = path.join(root, f);
  const dst = path.join(www, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log(`Copied ${f} to www/`);
  }
}

console.log('Build completed successfully.');

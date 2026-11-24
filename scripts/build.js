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

// Read or bump version.json (preserve committed timestamp in CI builds unless --bump is passed)
const verPath = path.join(root, 'version.json');
const shouldBump = process.argv.includes('--bump');
let verData = {
  version: '1.0.1',
  commit: 'latest',
  timestamp: Date.now(),
  releaseUrl: 'https://github.com/WebEssentz/block-dreamer/releases/tag/latest-apk',
  apkUrl: 'https://github.com/WebEssentz/block-dreamer/releases/download/latest-apk/app-debug.apk'
};

try {
  if (fs.existsSync(verPath)) {
    const existing = JSON.parse(fs.readFileSync(verPath, 'utf8'));
    verData = { ...verData, ...existing };
  }
  if (shouldBump || !fs.existsSync(verPath)) {
    const { execSync } = require('child_process');
    let commit = verData.commit;
    try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim() || commit; } catch (_) {}
    verData.commit = commit;
    verData.timestamp = Date.now();
    fs.writeFileSync(verPath, JSON.stringify(verData, null, 2) + '\n');
    console.log(`Updated version.json (timestamp=${verData.timestamp})`);
  }
} catch (e) {
  console.warn('Could not process version.json', e.message);
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
  if (!fs.existsSync(src)) continue;

  if (f === 'index.html') {
    let html = fs.readFileSync(src, 'utf8');
    const metaTag = `<script>window.__BD_BUNDLED__=${JSON.stringify({
      version: verData.version,
      commit: verData.commit,
      timestamp: verData.timestamp
    })};</script>`;
    html = html.replace('<!-- BD_BUNDLED_META -->', metaTag);
    fs.writeFileSync(dst, html, 'utf8');
    console.log('Built index.html -> www/index.html (with bundled version metadata)');
  } else {
    fs.copyFileSync(src, dst);
    console.log(`Copied ${f} to www/`);
  }
}

console.log('Build completed successfully.');

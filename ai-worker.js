'use strict';
importScripts('engine.js');

const ORT_VER = '1.20.1';
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VER + '/dist/';
const { SHAPES, N_SHAPES } = Engine;

const GAMMA = 0.995, RANK_BONUS = 10.0;
const NA = 192, NP = 19, NV = 78, PS = NP * 64, CHUNK = 96;
const F_LINES = 0, F_GAIN = 1, F_FREE = 2, F_HAND = 3, F_FILL = 4;

let session = null, META = { rstd: 1 };
let CFG = { beam: 6, topk: 6, samples: 3 };
let rng = Engine.mulberry32(1);
let plan = [], expect = null;

// ---------- tables (bitboards: cells 0..31 in lo, 32..63 in hi) ----------
const TW = SHAPES.reduce((s, x) => s + x.w, 0);
const WN = Float32Array.from(SHAPES.map(s => s.w / TW));
const NCELL = Float32Array.from(SHAPES.map(s => s.cells.length));
const PL = new Int32Array(N_SHAPES * 64), PH = new Int32Array(N_SHAPES * 64), PV = new Uint8Array(N_SHAPES * 64);
for (let s = 0; s < N_SHAPES; s++) {
  for (let a = 0; a < 64; a++) {
    const r = a >> 3, c = a & 7;
    if (!SHAPES[s].cells.every(([dr, dc]) => r + dr < 8 && c + dc < 8)) continue;
    let lo = 0, hi = 0;
    for (const [dr, dc] of SHAPES[s].cells) {
      const i = (r + dr) * 8 + (c + dc);
      if (i < 32) lo |= (1 << i); else hi |= (1 << (i - 32));
    }
    PL[s * 64 + a] = lo; PH[s * 64 + a] = hi; PV[s * 64 + a] = 1;
  }
}
const RL = new Int32Array(8), RH = new Int32Array(8), CL = new Int32Array(8), CH = new Int32Array(8);
for (let r = 0; r < 8; r++) { if (r < 4) RL[r] = 255 << (8 * r); else RH[r] = 255 << (8 * (r - 4)); }
for (let c = 0; c < 8; c++) for (let r = 0; r < 8; r++) { if (r < 4) CL[c] |= 1 << (c + 8 * r); else CH[c] |= 1 << (c + 8 * (r - 4)); }

function popcnt(x) { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; }

const FA = new Uint8Array(N_SHAPES);
function fitAny(lo, hi, out) {
  for (let s = 0; s < N_SHAPES; s++) {
    let ok = 0; const b = s * 64;
    for (let a = 0; a < 64; a++) {
      if (PV[b + a] && !(lo & PL[b + a]) && !(hi & PH[b + a])) { ok = 1; break; }
    }
    out[s] = ok;
  }
}
function freedom(lo, hi) { fitAny(lo, hi, FA); let f = 0; for (let s = 0; s < N_SHAPES; s++) f += FA[s] * WN[s]; return f; }

function mkState(board, hand, combo, miss) {
  let lo = 0, hi = 0;
  for (let i = 0; i < 64; i++) if (board[i]) { if (i < 32) lo |= (1 << i); else hi |= (1 << (i - 32)); }
  return { lo, hi, hand: hand.slice(), combo, miss };
}

// exact copy of Dreamer.apply for one move
function apply(st, slot, a) {
  const pid = st.hand[slot];
  const blo = st.lo | PL[pid * 64 + a], bhi = st.hi | PH[pid * 64 + a];
  let n = 0, clo = 0, chi = 0;
  for (let r = 0; r < 8; r++) if ((blo & RL[r]) === RL[r] && (bhi & RH[r]) === RH[r]) { n++; clo |= RL[r]; chi |= RH[r]; }
  for (let c = 0; c < 8; c++) if ((blo & CL[c]) === CL[c] && (bhi & CH[c]) === CH[c]) { n++; clo |= CL[c]; chi |= CH[c]; }
  const nlo = blo & ~clo, nhi = bhi & ~chi;
  const cleared = n > 0;
  const newCombo = cleared ? st.combo + 1 : st.combo;
  const nmiss = cleared ? 0 : st.miss + 1;
  const ncombo = (!cleared && nmiss >= 3) ? 0 : newCombo;
  let gain = NCELL[pid] + (cleared ? 10 * n * n * newCombo : 0);
  if (cleared && nlo === 0 && nhi === 0) gain += 200;
  const nh = st.hand.slice(); nh[slot] = -1;
  return { lo: nlo, hi: nhi, hand: nh, combo: ncombo, miss: nmiss, gain, n };
}

// ---------- encode (port of encode() + Dreamer.dream features) ----------
function encodeBatch(states) {
  const B = states.length;
  const planes = new Float32Array(B * PS), vec = new Float32Array(B * NV), mask = new Float32Array(B * NA);
  const any = new Uint8Array(B);
  for (let b = 0; b < B; b++) {
    const st = states[b], bp = b * PS, bv = b * NV, bm = b * NA;
    for (let i = 0; i < 64; i++) planes[bp + i] = i < 32 ? (st.lo >>> i) & 1 : (st.hi >>> (i - 32)) & 1;
    for (let slot = 0; slot < 3; slot++) {
      const pid = st.hand[slot];
      if (pid < 0) continue;
      for (const [r, c] of SHAPES[pid].cells) vec[bv + slot * 25 + r * 5 + c] = 1;
      for (let a = 0; a < 64; a++) {
        if (!PV[pid * 64 + a] || (st.lo & PL[pid * 64 + a]) || (st.hi & PH[pid * 64 + a])) continue;
        planes[bp + (1 + slot) * 64 + a] = 1; mask[bm + slot * 64 + a] = 1; any[b] = 1;
        const ns = apply(st, slot, a);
        fitAny(ns.lo, ns.hi, FA);
        let free = 0; for (let s = 0; s < N_SHAPES; s++) free += FA[s] * WN[s];
        let have = 0, fh = 0;
        for (let k = 0; k < 3; k++) if (ns.hand[k] >= 0) { have++; fh += FA[ns.hand[k]]; }
        const handOk = have > 0 ? fh / have : 1;
        const base = bp + (4 + slot * 5) * 64 + a;
        planes[base + F_LINES * 64] = Math.min(ns.n / 4, 1);
        planes[base + F_GAIN * 64] = Math.log1p(ns.gain) / 6;
        planes[base + F_FREE * 64] = free;
        planes[base + F_HAND * 64] = handOk;
        planes[base + F_FILL * 64] = (popcnt(ns.lo) + popcnt(ns.hi)) / 64;
      }
    }
    vec[bv + 75] = Math.min(st.combo, 8) / 8;
    vec[bv + 76] = Math.min(st.miss, 3) / 3;
    vec[bv + 77] = freedom(st.lo, st.hi);
  }
  return { planes, vec, mask, any };
}

async function runNet(enc, B) {
  const logits = new Float32Array(B * NA), values = new Float32Array(B);
  for (let i = 0; i < B; i += CHUNK) {
    const n = Math.min(CHUNK, B - i);
    const out = await session.run({
      planes: new ort.Tensor('float32', enc.planes.slice(i * PS, (i + n) * PS), [n, NP, 8, 8]),
      vec: new ort.Tensor('float32', enc.vec.slice(i * NV, (i + n) * NV), [n, NV]),
      mask: new ort.Tensor('float32', enc.mask.slice(i * NA, (i + n) * NA), [n, NA]),
    });
    logits.set(out.logits.data, i * NA); values.set(out.value.data, i);
  }
  return { logits, values };
}

function topIdx(arr, off, kk) {
  const idx = [];
  for (let a = 0; a < NA; a++) if (arr[off + a] > -1e8) idx.push(a);
  idx.sort((x, y) => arr[off + y] - arr[off + x]);
  return idx.slice(0, kk);
}

function pickW() { let r = rng() * TW, up = 0; for (let i = 0; i < N_SHAPES; i++) { up += SHAPES[i].w; if (r <= up) return i; } return N_SHAPES - 1; }
function sampleHand(st) {
  fitAny(st.lo, st.hi, FA);
  const cands = []; let allPick = -1, anyPick = -1;
  for (let k = 0; k < 16; k++) {
    const h = [pickW(), pickW(), pickW()]; cands.push(h);
    const fit = h.map(x => FA[x]);
    if (allPick < 0 && fit.every(Boolean)) allPick = k;
    if (anyPick < 0 && fit.some(Boolean)) anyPick = k;
  }
  return cands[allPick >= 0 ? allPick : (anyPick >= 0 ? anyPick : 0)];
}

async function greedy(root) {
  const enc = encodeBatch([root]); const out = await runNet(enc, 1);
  let best = -1, bv = -Infinity;
  for (let a = 0; a < NA; a++) if (out.logits[a] > -1e8 && out.logits[a] > bv) { bv = out.logits[a]; best = a; }
  return best;
}

// ---------- the "dream": beam search over the whole hand ----------
async function dream(root) {
  const rstd = META.rstd || 1, death = RANK_BONUS / rstd;
  let states = [root], cum = [0], paths = [[]];
  const nPieces = root.hand.filter(x => x >= 0).length;
  for (let lvl = 0; lvl < nPieces; lvl++) {
    const B = states.length;
    const out = await runNet(encodeBatch(states), B);
    const kids = [];
    for (let i = 0; i < B; i++) {
      for (const a of topIdx(out.logits, i * NA, CFG.topk)) {
        const ns = apply(states[i], a >> 6, a & 63);
        kids.push({ st: ns, cum: cum[i] + ns.gain / 10 / rstd, path: paths[i].concat(a) });
      }
    }
    if (!kids.length) break;
    const vals = new Float32Array(kids.length);
    if (lvl === nPieces - 1) {
      const M = CFG.samples, flat = [];
      for (const k of kids) for (let m = 0; m < M; m++)
        flat.push({ lo: k.st.lo, hi: k.st.hi, hand: sampleHand(k.st), combo: k.st.combo, miss: k.st.miss });
      const enc = encodeBatch(flat); const o2 = await runNet(enc, flat.length);
      for (let i = 0; i < kids.length; i++) {
        let s = 0;
        for (let m = 0; m < M; m++) { const j = i * M + m; s += enc.any[j] ? o2.values[j] : -death; }
        vals[i] = s / M;
      }
    } else {
      const enc = encodeBatch(kids.map(k => k.st)); const o2 = await runNet(enc, kids.length);
      for (let i = 0; i < kids.length; i++) vals[i] = enc.any[i] ? o2.values[i] : -death;
    }
    const order = kids.map((k, i) => i).sort((x, y) => (kids[y].cum + GAMMA * vals[y]) - (kids[x].cum + GAMMA * vals[x])).slice(0, CFG.beam);
    states = order.map(i => kids[i].st); cum = order.map(i => kids[i].cum); paths = order.map(i => kids[i].path);
  }
  let path = paths[0];
  if (!path || !path.length) { const a = await greedy(root); if (a < 0) return []; path = [a]; }
  const steps = []; let cur = root;
  for (const a of path) {
    const slot = a >> 6, anc = a & 63, sid = cur.hand[slot];
    cur = apply(cur, slot, anc);
    steps.push({ i: slot, r: anc >> 3, c: anc & 7, sid, lo: cur.lo, hi: cur.hi });
  }
  return steps;
}

async function move(m) {
  const root = mkState(m.state.board, m.state.hand, m.state.combo, m.state.miss);
  let st = plan[0], replanned = false;
  const t0 = performance.now();
  if (st && expect && expect.lo === root.lo && expect.hi === root.hi && root.hand[st.i] === st.sid) {
    plan.shift();
  } else {
    replanned = !!st;
    plan = await dream(root);
    st = plan.shift();
  }
  if (!st) return { type: 'move', id: m.id, none: true };
  expect = { lo: st.lo, hi: st.hi };
  return { type: 'move', id: m.id, i: st.i, r: st.r, c: st.c, replanned,
           plan: plan.map(p => ({ i: p.i, r: p.r, c: p.c })), ms: performance.now() - t0 };
}

async function handle(m) {
  if (m.type === 'init') {
    CFG = m.preset === 'fast' ? { beam: 4, topk: 4, samples: 2 } : { beam: 6, topk: 6, samples: 3 };
    importScripts(ORT_BASE + 'ort.wasm.min.js');
    ort.env.wasm.wasmPaths = ORT_BASE;
    ort.env.wasm.numThreads = 1;      // no SharedArrayBuffer needed -> works on GitHub Pages
    ort.env.wasm.proxy = false;       // we ARE the worker
    const [buf, meta] = await Promise.all([
      fetch('model.onnx').then(r => { if (!r.ok) throw new Error('model.onnx not found'); return r.arrayBuffer(); }),
      fetch('model.json').then(r => r.json()).catch(() => ({ rstd: 1 })),
    ]);
    META = meta;
    session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const warm = mkState(new Array(64).fill(0), [0, 1, 2], 0, 0);
    await runNet(encodeBatch([warm]), 1);               // throwaway run so the first real move is fast
    postMessage({ type: 'ready' });
  } else if (m.type === 'reset') {
    rng = Engine.mulberry32((m.seed >>> 0) ^ 0xA5A5A5); plan = []; expect = null;
  } else if (m.type === 'move') {
    postMessage(await move(m));
  }
}

let chain = Promise.resolve();
onmessage = e => {
  chain = chain.then(() => handle(e.data)).catch(err =>
    postMessage({ type: 'error', message: String((err && err.message) || err) }));
};
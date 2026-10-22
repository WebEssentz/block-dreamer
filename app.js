(() => {
'use strict';
const { GRID, Game, pieceSize, aiSeedOf } = Engine;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const ease = t => t * t * (3 - 2 * t);
const hz = n => 440 * Math.pow(2, (n - 69) / 12);

/* =========================================================
   SOUND (synthesized, no files)
========================================================= */
const Sfx = {
  ctx: null, on: true,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.on = false; } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f0, dur, vol = .2, type = 'sine', f1 = null, when = 0, m = 1) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(vol * m, t + .006);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + .03);
  },
  notes(list, step, dur, vol, type, m = 1, when = 0) { list.forEach((n, i) => this.tone(hz(n), dur, vol, type, null, when + i * step, m)); },
  play(name, m = 1) {
    switch (name) {
      case 'pick': this.tone(880, .06, .12, 'sine', 1250, 0, m); break;
      case 'place': this.tone(220, .16, .4, 'sine', 70, 0, m); this.tone(520, .03, .08, 'square', null, 0, m); break;
      case 'bad': this.tone(150, .2, .12, 'square', 95, 0, m); break;
      case 'over': this.notes([67, 64, 60, 55], .22, .45, .2, 'triangle', m, .3); break;
      case 'win': this.notes([72, 76, 79, 84, 88], .12, .5, .2, 'triangle', m); break;
      case 'lose': this.notes([64, 60, 57, 52], .2, .5, .18, 'triangle', m); break;
      case 'boardclear': this.notes([60, 64, 67, 72, 76, 79, 84, 88, 91, 96], .07, .6, .16, 'triangle', m, .25); break;
    }
  },
  clear(lines, combo, m = 1) {
    const lvl = Math.min(combo, 8), base = 72 + lvl * 2;
    let ns = [0, 4, 7, 12]; if (lines >= 2) ns = ns.concat([16, 19]); if (lines >= 3) ns = ns.concat([24, 28]);
    this.tone(150, .22, .35, 'sine', 55, 0, m);
    this.notes(ns.map(i => base + i), .055, .4, .17, 'triangle', m);
  },
  onInfo(info, m = 1) {
    this.play('place', m);
    if (info.lines) this.clear(info.lines, info.combo, m);
    if (info.boardClear) this.play('boardclear', m);
  },
};

/* =========================================================
   AI CLIENT (web worker)
========================================================= */
const AI = {
  w: null, ready: false, err: null, id: 0, pend: new Map(), waiters: [],
  init() {
    if (this.w) return;
    try { this.w = new Worker('ai-worker.js'); } catch (e) { this.err = e.message; return; }
    const flush = ok => this.waiters.splice(0).forEach(f => f(ok));
    this.w.onmessage = e => {
      const m = e.data;
      if (m.type === 'ready') { this.ready = true; flush(true); }
      else if (m.type === 'error') { this.err = m.message; flush(false); this.pend.forEach(p => p.reject(new Error(m.message))); this.pend.clear(); }
      else { const p = this.pend.get(m.id); if (p) { this.pend.delete(m.id); p.resolve(m); } }
    };
    this.w.onerror = ev => { this.err = ev.message || 'worker failed'; flush(false); };
    this.w.postMessage({ type: 'init', preset: (coarse || (navigator.hardwareConcurrency || 4) <= 4) ? 'fast' : 'smart' });
  },
  whenReady() { return this.ready ? Promise.resolve(true) : this.err ? Promise.resolve(false) : new Promise(r => this.waiters.push(r)); },
  reset(seed) { this.w.postMessage({ type: 'reset', seed }); },
  move(game) {
    const state = { board: game.board.map(v => v ? 1 : 0), hand: game.hand.map(p => p ? p.sid : -1), combo: game.combo, miss: game.miss };
    return new Promise((resolve, reject) => { const id = ++this.id; this.pend.set(id, { resolve, reject }); this.w.postMessage({ type: 'move', id, state }); });
  },
};

/* =========================================================
   RENDERING
========================================================= */
const CELL = 56, BW = GRID * CELL, BX = 16, BY = 16, TRAY_Y = BY + BW + 22, SLOT_H = 120, CW = BW + 32;
const FULL_H = TRAY_Y + SLOT_H + 14, MINI_H = BY + BW + 16, TRAY_CELL = 26;
const FADE = .40, POP = .18;
const COLORS = [null, '#f2f2ee', '#b4c0ff', '#8fe0c8', '#ffd08a', '#ff9fb5']; COLORS[9] = '#6f757e';
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const RGB = COLORS.map(c => c ? hex(c) : null);
const isLight = () => document.documentElement.dataset.theme === 'light';
const PAL = {
  dark: ['#f2f2ee', '#b4c0ff', '#8fe0c8', '#ffd08a', '#ff9fb5'],
  light: ['#2a2a27', '#6d83ff', '#25b08a', '#f0a030', '#f2557f']
};
const T = {};
function applyTheme() {
  const L = isLight(), p = PAL[L ? 'light' : 'dark'];
  p.forEach((c, i) => RGB[i + 1] = hex(c));
  Object.assign(T, L ? {
    ink: '18,18,17', bg: '245,245,240', bgHex: '#f5f5f0', fg: '#121211', dim: '#9a9a92',
    pshadow: '255,255,255', gold: [196, 118, 0], orange: [214, 100, 20], pop: [18, 18, 17], tints: PAL.light
  } : {
    ink: '255,255,255', bg: '18,18,17', bgHex: '#121211', fg: '#f5f5f0', dim: '#74746d',
    pshadow: '0,0,0', gold: [255, 208, 138], orange: [255, 170, 100], pop: [255, 255, 255], tints: PAL.dark
  });
}
applyTheme();
addEventListener('themechange', applyTheme);
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
function rainbow(r, c, t) {
  const h = ((((r + c) / GRID + t * .8) % 1) + 1) % 1, s = .55, v = 1, i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), u = v * (1 - (1 - f) * s);
  return [[v, u, p], [q, v, p], [p, v, u], [p, q, v], [u, p, v], [v, p, q]][i % 6].map(x => x * 255);
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawBlock(ctx, x, y, s, col, alpha = 1, scale = 1) {
  const inset = Math.max(1.5, s * .05), size = (s - inset * 2) * scale, px = x + s / 2 - size / 2, py = y + s / 2 - size / 2;
  ctx.globalAlpha = alpha;
  const g = ctx.createLinearGradient(px, py, px, py + size);
  g.addColorStop(0, rgba(mixc(col, [255, 255, 255], .3))); g.addColorStop(1, rgba(mixc(col, [0, 0, 0], .16)));
  rr(ctx, px, py, size, size, size * .24); ctx.fillStyle = g; ctx.fill();
  rr(ctx, px + size * .14, py + size * .09, size * .72, size * .13, size * .06); ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fill();
  ctx.globalAlpha = 1;
}
const cellCenter = (r, c) => [BX + c * CELL + CELL / 2, BY + r * CELL + CELL / 2];

class Effects {
  constructor() { this.reset(); }
  reset() { this.particles = []; this.fading = []; this.popups = []; this.pops = {}; this.shake = 0; this.flash = 0; this.shown = 0; }
  text(t, x, y, color, size, life = 1.1) { this.popups.push({ t, x: clamp(x, 90, CW - 90), y, age: 0, color, size, life }); }
  onPlace(info) {
    for (const [r, c] of info.placed) this.pops[r * 8 + c] = 0;
    const n = info.lines; if (!n) return;
    const pr = info.placed.reduce((s, p) => s + p[0], 0) / info.placed.length, pc = info.placed.reduce((s, p) => s + p[1], 0) / info.placed.length;
    let sx = 0, sy = 0;
    for (const [r, c, color] of info.cleared) {
      const delay = Math.hypot(r - pr, c - pc) * .05;
      this.fading.push({ r, c, color, age: -delay, rainbow: info.rainbow });
      const [x, y] = cellCenter(r, c); sx += x; sy += y;
      for (let i = 0; i < 5; i++) {
        const ang = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 210, life = .4 + Math.random() * .35;
        this.particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 60, wait: delay, life, max: life, color, rainbow: info.rainbow, r, c });
      }
    }
    const cx = sx / info.cleared.length, cy = sy / info.cleared.length;
    this.text('+' + info.gain, cx, cy, T.gold, 38);
    if (n >= 2) this.text(n + ' LINES', cx, cy - 46, T.pop, 26);
    if (info.combo >= 2) this.text('COMBO x' + info.combo, cx, cy + 46, T.orange, 26, 1.4);
    this.shake = Math.max(this.shake, Math.min(14, 3 + 3 * n));
    if (info.boardClear) { this.text('BOARD CLEAR', CW / 2, BY + BW / 2, T.pop, 44, 1.8); this.flash = 1; this.shake = 18; }
  }
  update(dt, score) {
    for (const p of this.particles) { if (p.wait > 0) { p.wait -= dt; continue; } p.vy += 800 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const f of this.fading) f.age += dt;
    this.fading = this.fading.filter(f => f.age < FADE);
    for (const k in this.pops) { this.pops[k] += dt; if (this.pops[k] >= POP) delete this.pops[k]; }
    for (const p of this.popups) { p.age += dt; p.y -= 50 * dt; }
    this.popups = this.popups.filter(p => p.age < p.life);
    this.shake = Math.max(0, this.shake - 45 * dt); this.flash = Math.max(0, this.flash - 2.5 * dt);
    this.shown += (score - this.shown) * Math.min(1, dt * 8); if (Math.abs(score - this.shown) < .5) this.shown = score;
  }
  draw(ctx, t) {
    for (const f of this.fading) {
      const k = Math.max(0, f.age) / FADE;
      const sc = k < .2 ? 1 + .25 * (k / .2) : 1.25 * (1 - (k - .2) / .8);
      if (sc < .1) continue;
      const alpha = k < .3 ? 1 : 1 - (k - .3) / .7;
      let col = f.rainbow ? rainbow(f.r, f.c, t) : RGB[f.color];
      col = mixc(col, [255, 255, 255], .25 * (1 - k));
      drawBlock(ctx, BX + f.c * CELL, BY + f.r * CELL, CELL, col, Math.max(0, alpha), sc);
    }
    for (const p of this.particles) {
      if (p.wait > 0) continue;
      const s = 9 * p.life / p.max; if (s < 2) continue;
      const col = p.rainbow ? rainbow(p.r, p.c, t) : mixc(RGB[p.color], [255, 255, 255], .3);
      rr(ctx, p.x - s / 2, p.y - s / 2, s, s, 2); ctx.fillStyle = rgba(col); ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const k = p.age / p.life, a = Math.min(1, (1 - k) * 2.5);
      ctx.font = `800 ${p.size}px Inter,system-ui,sans-serif`;
      ctx.fillStyle = `rgba(${T.pshadow},${.45 * a})`; ctx.fillText(p.t, p.x + 2, p.y + 3);
      ctx.fillStyle = rgba(p.color, a); ctx.fillText(p.t, p.x, p.y);
    }
    if (this.flash > 0) { rr(ctx, BX - 8, BY - 8, BW + 16, BW + 16, 24); ctx.fillStyle = `rgba(255,240,200,${.28 * this.flash})`; ctx.fill(); }
  }
}

class BoardView {
  constructor(canvas, { interactive = false, tray = true } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.interactive = interactive; this.tray = tray;
    this.H = tray ? FULL_H : MINI_H; this.fx = new Effects();
    this.drag = null; this.aiMove = null; this.ghost = []; this.dim = [false, false, false];
    this.game = null; this.locked = true; this.k = 1; this.onInfo = null; this.onBad = null; this.onPick = null;
    canvas.style.aspectRatio = `${CW} / ${this.H}`;
    if (interactive) this.bind();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
  }
  resize() {
    const w = this.cv.clientWidth; if (!w) return;
    const d = Math.min(devicePixelRatio || 1, 2), pw = Math.round(w * d);
    if (this.cv.width !== pw) { this.cv.width = pw; this.cv.height = Math.round(pw * this.H / CW); }
    this.k = this.cv.width / CW;
  }
  setGame(g) { this.game = g; this.fx.reset(); this.drag = null; this.aiMove = null; this.ghost = []; this.refreshDim(); }
  refreshDim() { const g = this.game; this.dim = g.hand.map(p => p ? !Engine.fitsAnywhere(g.board, p.cells) : false); }
  commit(i, r, c) { const info = this.game.place(i, r, c); this.fx.onPlace(info); this.refreshDim(); return info; }
  lift(d) { return d.touch ? 84 : 30; }
  anchorOf(cells, x, y, lift) {
    const [h, w] = pieceSize(cells);
    const px = clamp(x - w * CELL / 2, BX, BX + BW - w * CELL);
    const py = clamp(y - h * CELL / 2 - lift, BY, BY + BW - h * CELL);
    return { r: Math.round((py - BY) / CELL), c: Math.round((px - BX) / CELL), px, py };
  }
  toLogical(e) { const r = this.cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * CW / r.width, y: (e.clientY - r.top) * this.H / r.height }; }
  bind() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', e => {
      if (this.locked || !this.game || this.game.over) return;
      const p = this.toLogical(e); if (p.y < TRAY_Y - 24) return;
      const i = clamp(Math.floor((p.x - BX) / (BW / 3)), 0, 2); if (!this.game.hand[i]) return;
      this.drag = { i, x: p.x, y: p.y, k: 0, touch: e.pointerType !== 'mouse' };
      cv.setPointerCapture(e.pointerId); e.preventDefault(); this.onPick && this.onPick();
    });
    cv.addEventListener('pointermove', e => { if (this.drag) { const p = this.toLogical(e); this.drag.x = p.x; this.drag.y = p.y; } });
    cv.addEventListener('pointerup', e => {
      const d = this.drag; if (!d) return; this.drag = null;
      const p = this.toLogical(e), piece = this.game.hand[d.i]; if (!piece || this.locked) return;
      if (p.x < 0 || p.x > CW || p.y < 0 || p.y > this.H) { this.onBad && this.onBad(); return; }
      const a = this.anchorOf(piece.cells, p.x, p.y, this.lift(d));
      if (this.game.canPlace(d.i, a.r, a.c)) { const info = this.commit(d.i, a.r, a.c); this.onInfo && this.onInfo(this, info); }
      else this.onBad && this.onBad();
    });
    cv.addEventListener('pointercancel', () => { this.drag = null; });
  }
  trayOrigin(i, cells) {
    const [h, w] = pieceSize(cells), sw = BW / 3;
    return [BX + i * sw + (sw - w * TRAY_CELL) / 2, TRAY_Y + (SLOT_H - h * TRAY_CELL) / 2];
  }
  update(dt) { if (this.drag) this.drag.k = Math.min(1, this.drag.k + dt / .12); }
  drawFog(t) {
    const ctx = this.ctx;
    rr(ctx, BX - 8, BY - 8, BW + 16, BW + 16, 24);
    ctx.fillStyle = `rgba(${T.ink},.05)`; ctx.fill();
    ctx.strokeStyle = `rgba(${T.ink},.1)`; ctx.lineWidth = 1; ctx.stroke();
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const a = .03 + .05 * (.5 + .5 * Math.sin(t * 2 - (r + c) * .6));
      rr(ctx, BX + c * CELL + 3, BY + r * CELL + 3, CELL - 6, CELL - 6, 11);
      ctx.fillStyle = `rgba(${T.ink},${a})`; ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${T.ink},.6)`; ctx.font = '700 24px Inter,system-ui,sans-serif';
    ctx.fillText('Hidden until the end', CW / 2, BY + BW / 2);
  }
  draw(t) {
    const ctx = this.ctx, g = this.game, fx = this.fx; if (!g || !this.k) return;
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0); ctx.clearRect(0, 0, CW, this.H);
    if (this.fog && !g.over) { this.drawFog(t); return; }
    ctx.save();
    if (fx.shake > .1) ctx.translate((Math.random() - .5) * fx.shake, (Math.random() - .5) * fx.shake);
    rr(ctx, BX - 8, BY - 8, BW + 16, BW + 16, 24); ctx.fillStyle = `rgba(${T.ink},.05)`; ctx.fill();
    ctx.strokeStyle = `rgba(${T.ink},.1)`; ctx.lineWidth = 1; ctx.stroke();

    // drag hint (rows/cols that would clear)
    let lit = null, multi = false, hintRGB = null, anc = null, hlR = [], hlC = [];
    const d = this.drag;
    if (d && g.hand[d.i]) {
      const piece = g.hand[d.i]; anc = this.anchorOf(piece.cells, d.x, d.y, this.lift(d));
      if (g.canPlace(d.i, anc.r, anc.c)) {
        const sim = g.board.slice(); for (const [dr, dc] of piece.cells) sim[(anc.r + dr) * 8 + anc.c + dc] = piece.color;
        for (let a = 0; a < 8; a++) {
          let rf = true, cf = true; for (let b = 0; b < 8; b++) { if (!sim[a * 8 + b]) rf = false; if (!sim[b * 8 + a]) cf = false; }
          if (rf) hlR.push(a); if (cf) hlC.push(a);
        }
        lit = new Set(); hlR.forEach(a => { for (let b = 0; b < 8; b++) lit.add(a * 8 + b); }); hlC.forEach(b => { for (let a = 0; a < 8; a++) lit.add(a * 8 + b); });
        if (!lit.size) lit = null; multi = hlR.length + hlC.length >= 2; hintRGB = RGB[piece.color];
      } else anc.bad = true;
    }
    const pulse = .5 + .5 * Math.sin(t * 10);
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const x = BX + c * CELL, y = BY + r * CELL, v = g.board[r * 8 + c], idx = r * 8 + c;
      if (!v) { rr(ctx, x + 3, y + 3, CELL - 6, CELL - 6, 11); ctx.fillStyle = `rgba(${T.ink},.06)`; ctx.fill(); continue; }
      let col = RGB[v]; if (lit && lit.has(idx)) col = multi ? rainbow(r, c, t) : mixc(hintRGB, [255, 255, 255], .25);
      const pk = fx.pops[idx]; drawBlock(ctx, x, y, CELL, col, 1, pk !== undefined ? 1 + .18 * Math.sin(Math.PI * pk / POP) : 1);
    }
    if (lit) {
      for (const i of lit) { const r = i >> 3, c = i & 7; rr(ctx, BX + c * CELL + 3, BY + r * CELL + 3, CELL - 6, CELL - 6, 11); ctx.fillStyle = `rgba(${T.ink},${.06 + .14 * pulse})`; ctx.fill(); }
      ctx.lineWidth = 2.5; ctx.strokeStyle = multi ? rgba(rainbow(0, 4, t)) : rgba(mixc(hintRGB, [255, 255, 255], .45));
      hlR.forEach(a => { rr(ctx, BX - 2, BY + a * CELL - 2, BW + 4, CELL + 4, 12); ctx.stroke(); });
      hlC.forEach(b => { rr(ctx, BX + b * CELL - 2, BY - 2, CELL + 4, BW + 4, 12); ctx.stroke(); });
    }
    if (d && anc && !anc.bad) {
      const piece = g.hand[d.i];
      for (const [dr, dc] of piece.cells) {
        const rr_ = anc.r + dr, cc = anc.c + dc; if (lit && lit.has(rr_ * 8 + cc)) continue;
        rr(ctx, BX + cc * CELL + 3, BY + rr_ * CELL + 3, CELL - 6, CELL - 6, 11); ctx.fillStyle = rgba(RGB[piece.color], .42); ctx.fill();
      }
    }
    // AI "dream" ghosts
    for (const st of this.ghost) {
      const p = g.hand[st.i]; if (!p) continue;
      for (const [dr, dc] of p.cells) { rr(ctx, BX + (st.c + dc) * CELL + 4, BY + (st.r + dr) * CELL + 4, CELL - 8, CELL - 8, 10); ctx.fillStyle = `rgba(${T.ink},.09)`; ctx.fill(); ctx.strokeStyle = `rgba(${T.ink},.22)`; ctx.lineWidth = 1; ctx.stroke(); }
    }
    const am = this.aiMove;
    if (am && g.hand[am.i]) {
      for (const [dr, dc] of g.hand[am.i].cells) { rr(ctx, BX + (am.c + dc) * CELL + 3, BY + (am.r + dr) * CELL + 3, CELL - 6, CELL - 6, 11); ctx.fillStyle = rgba(RGB[g.hand[am.i].color], .3 * ease(am.t)); ctx.fill(); }
    }
    fx.draw(ctx, t);
    ctx.restore();

    // tray
    if (this.tray) {
      for (let i = 0; i < 3; i++) {
        rr(ctx, BX + i * BW / 3 + 4, TRAY_Y, BW / 3 - 8, SLOT_H, 20); ctx.fillStyle = `rgba(${T.ink},.04)`; ctx.fill();
        const p = g.hand[i]; if (!p || (d && d.i === i) || (am && am.i === i)) continue;
        const [x0, y0] = this.trayOrigin(i, p.cells);
        for (const [dr, dc] of p.cells) drawBlock(ctx, x0 + dc * TRAY_CELL, y0 + dr * TRAY_CELL, TRAY_CELL, RGB[p.color], this.dim[i] ? .3 : 1);
      }
    }
    // piece in flight (AI)
    if (am && g.hand[am.i]) {
      const p = g.hand[am.i], k = ease(clamp(am.t, 0, 1)), tx = BX + am.c * CELL, ty = BY + am.r * CELL;
      if (this.tray) {
        const [x0, y0] = this.trayOrigin(am.i, p.cells), x = x0 + (tx - x0) * k, y = y0 + (ty - y0) * k, s = TRAY_CELL + (CELL - TRAY_CELL) * k;
        for (const [dr, dc] of p.cells) drawBlock(ctx, x + dc * s, y + dr * s, s, RGB[p.color]);
      } else {
        const s = CELL * (1.5 - .5 * k);
        for (const [dr, dc] of p.cells) drawBlock(ctx, tx + (dc * CELL) + CELL / 2 - s / 2, ty + dr * CELL + CELL / 2 - s / 2, s, RGB[p.color], .3 + .7 * k);
      }
    }
    // dragged piece
    if (d && g.hand[d.i]) {
      const p = g.hand[d.i], k = ease(d.k), s = TRAY_CELL + (CELL - TRAY_CELL) * k, [h, w] = pieceSize(p.cells);
      const px = clamp(d.x - w * s / 2, BX, BX + BW - w * s);
      const py = clamp(d.y - h * s / 2 - this.lift(d) * k, BY, BY + BW - h * s);
      for (const [dr, dc] of p.cells) { rr(ctx, px + dc * s + 4, py + dr * s + 12, s - 8, s - 8, 12); ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill(); }
      for (const [dr, dc] of p.cells) drawBlock(ctx, px + dc * s, py + dr * s, s, RGB[p.color], .97);
    }
    if (g.over) {
      ctx.fillStyle = `rgba(${T.bg},.7)`; rr(ctx, 0, 0, CW, this.H, 0); ctx.fill();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = T.fg;
      ctx.font = '800 38px Inter,system-ui,sans-serif'; ctx.fillText('No moves left', CW / 2, BY + BW / 2 - 10);
      ctx.fillStyle = `rgba(${T.ink},.6)`; ctx.font = '600 18px Inter,system-ui,sans-serif'; ctx.fillText(g.score.toLocaleString() + ' pts', CW / 2, BY + BW / 2 + 28);
    }
  }
}

/* =========================================================
   MATCH (solo / versus)
========================================================= */
const M = { mode: 'solo', seed: 0, you: null, ai: null, running: false, ended: false, raf: 0, last: 0, token: 0, ctl: null, speed: 3 };
const randomSeed = () => Math.floor(Math.random() * 1e6);
const pad6 = n => String(n).padStart(6, '0');
const STAT_KEY = 'bp_stats';
const Stats = {
  d: { best: 0, games: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, recent: [] },
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STAT_KEY) || '{}');
      if (saved && typeof saved === 'object') {
        for (const key of ['best', 'games', 'wins', 'losses', 'draws', 'streak', 'bestStreak']) {
          const value = Number(saved[key]);
          if (Number.isFinite(value) && value >= 0) this.d[key] = Math.floor(value);
        }
        if (Array.isArray(saved.recent)) {
          this.d.recent = saved.recent.slice(0, 8).filter(r =>
            r && ['solo', 'win', 'lose', 'draw'].includes(r.k) &&
            Number.isFinite(Number(r.y)) && Number.isFinite(Number(r.a))
          ).map(r => ({ k: r.k, y: Number(r.y), a: Number(r.a), t: Number(r.t) || 0 }));
        }
      }
      const oldBest = Number(localStorage.getItem('bp_best')) || 0;
      if (oldBest > this.d.best) this.d.best = oldBest;
    } catch (e) { console.warn('Could not load saved game stats.', e); }
  },
  save() {
    try {
      localStorage.setItem(STAT_KEY, JSON.stringify(this.d));
      localStorage.setItem('bp_best', String(this.d.best));
    } catch (e) {
      console.warn('Could not save game stats.', e);
      toast('Stats could not be saved in this browser.');
    }
  },
  record(kind, you, ai) {
    const d = this.d, isBest = you > d.best;
    d.games++;
    if (isBest) d.best = you;
    if (kind === 'win') { d.wins++; d.streak++; d.bestStreak = Math.max(d.bestStreak, d.streak); }
    else if (kind === 'lose') { d.losses++; d.streak = 0; }
    else if (kind === 'draw') d.draws++;
    d.recent = [{ k: kind, y: you, a: ai, t: Date.now() }].concat(d.recent).slice(0, 8);
    this.save();
    return isBest;
  }
};
Stats.load();

const RES = { win: 'Win', lose: 'Loss', draw: 'Draw', solo: 'Solo' };
const ago = t => {
  if (!t) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago';
};

function renderRecord() {
  const d = Stats.d, box = $('#record'); if (!box) return;
  box.hidden = d.games === 0; if (!d.games) return;
  const vs = d.wins + d.losses + d.draws;
  $('#recBest').textContent = d.best.toLocaleString();
  $('#recGames').textContent = d.games;
  $('#recWins').textContent = vs ? Math.round(d.wins / vs * 100) + '%' : '–';
  $('#recStreak').textContent = d.bestStreak;
  const recent = $('#recRecent');
  recent.replaceChildren();
  if (!d.recent.length) {
    const empty = document.createElement('p');
    empty.className = 'match-empty';
    empty.textContent = 'Play a match to start your streak.';
    recent.append(empty);
    return;
  }
  d.recent.forEach(r => {
    const item = document.createElement('div');
    item.className = 'match ' + r.k;
    const label = document.createElement('span');
    label.className = 'm-res';
    label.textContent = RES[r.k];
    const score = document.createElement('b');
    score.textContent = r.k === 'solo'
      ? r.y.toLocaleString()
      : `${r.y.toLocaleString()} – ${r.a.toLocaleString()}`;
    const time = document.createElement('small');
    time.textContent = ago(r.t);
    item.append(label, score, time);
    recent.append(item);
  });
}
renderRecord();

function panelHTML(cls, who, extra = '') {
  return `<section class="panel ${cls}"><div class="p-head"><div><small>${who}${cls === 'you' ? ' <em class="best"></em>' : ''}</small><b class="score">0</b></div>
    <div class="p-right"><div class="combo"><span class="cx">x0</span><span class="dots"><i></i><i></i><i></i></span></div>${extra}</div></div><canvas></canvas></section>`;
}
function buildArena(mode) {
  const arena = $('#arena'); const vs = mode === 'vs';
  arena.className = 'arena enter ' + (vs ? 'vs' : 'solo');
  arena.innerHTML = panelHTML('you', 'You') + (vs ? `<div class="vs-mid"><span>VS</span><div class="lead"><i></i></div></div>` + panelHTML('ai', 'AI', '<span class="status"></span>') : '');
  const mini = vs && innerWidth <= 760;
  const mk = (sel, opts) => {
    const root = $(sel, arena), v = new BoardView($('canvas', root), opts);
    v.hud = { score: $('.score', root), combo: $('.combo', root), cx: $('.cx', root), dots: $$('.dots i', root), status: $('.status', root), last: -1, lastC: -1 };
    return v;
  };
  M.you = mk('.panel.you', { interactive: true, tray: true });
  M.you.hud.best = $('.best', $('.panel.you', arena));
  M.you.hud.bestVal = Stats.d.best; M.you.hud.bestTxt = '';
  M.ai = vs ? mk('.panel.ai', { interactive: false, tray: !mini }) : null;
  if (M.ai) M.ai.fog = false;
  M.you.onPick = () => Sfx.play('pick');
  M.you.onBad = () => Sfx.play('bad');
  M.you.onInfo = (v, info) => Sfx.onInfo(info);
  buildSpectate(vs);
}
function buildSpectate(vs) {
  const old = $('#spec'); if (old) old.remove();
  if (!vs) return;
  const s = document.createElement('div'); s.id = 'spec'; s.className = 'glass';
  s.innerHTML = `<span class="sp-live"><i></i>Watching the AI</span><span class="sp-msg"></span>
    <div class="sp-speed" role="group" aria-label="Playback speed"><button type="button" data-s="1">1×</button><button type="button" data-s="3" class="on">3×</button><button type="button" data-s="8">Max</button></div>`;
  $('#game').appendChild(s);
  $$('.sp-speed button', s).forEach(b => b.addEventListener('click', () => {
    M.speed = Number(b.dataset.s);
    $$('.sp-speed button', s).forEach(x => x.classList.toggle('on', x === b));
  }));
}
function updateSpectate() {
  const s = $('#spec'); if (!s) return;
  const on = !!M.ai && M.running && !M.ended && M.you.game.over && !M.ai.game.over;
  s.classList.toggle('show', on); $('#arena').classList.toggle('spectate', on);
  if (!on) return;
  const y = M.you.game.score, a = M.ai.game.score;
  const msg = a > y ? `AI leads by ${(a - y).toLocaleString()}` : a === y ? 'Dead level' : `AI needs ${(y - a + 1).toLocaleString()} to pass you`;
  if (msg !== s._m) { s._m = msg; $('.sp-msg', s).textContent = msg; }
  s.classList.toggle('lead', a > y);
}
function newGames(seed) {
  M.seed = seed;
  M.you.setGame(new Game(seed)); if (M.ai) M.ai.setGame(new Game(seed, { altSeed: aiSeedOf(seed) }));
  M.you.locked = true;
  M.speed = 3; $$('#spec .sp-speed button').forEach(b => b.classList.toggle('on', b.dataset.s === '3'));
  M.ctl = { phase: 'think', pending: false, hold: 0, wait: 0, res: null, mv: null };
  $('#seedChip').textContent = '#' + pad6(seed) + (M.mode === 'vs' && QSCORE !== null && seed === QSEED ? ' · beat ' + QSCORE.toLocaleString() : '');
  $('#modeChip').textContent = M.mode === 'vs' ? 'You vs AI' : 'Solo';
}
function updateHUD(v) {
  const s = Math.round(v.fx.shown); if (v.hud.last !== s) { v.hud.last = s; v.hud.score.textContent = s.toLocaleString(); }
  const g = v.game, key = g.combo * 10 + g.miss;
  if (v.hud.lastC !== key) {
    v.hud.lastC = key; v.hud.cx.textContent = 'x' + g.combo; v.hud.combo.classList.toggle('hot', g.combo > 0);
    v.hud.dots.forEach((d, i) => d.classList.toggle('on', g.combo > 0 && i < 3 - g.miss));
  }
  if (v.hud.best) {
    const beat = s > v.hud.bestVal && v.hud.bestVal > 0;
    const txt = (beat ? 'New best ' : 'Best ') + Math.max(v.hud.bestVal, s).toLocaleString();
    if (txt !== v.hud.bestTxt) {
      v.hud.bestTxt = txt; v.hud.best.textContent = txt; v.hud.best.classList.toggle('beat', beat);
    }
  }
}
function aiStep(dt) {
  const v = M.ai; if (!v) return; const g = v.game, c = M.ctl, st = v.hud.status;
  if (g.over) { st.textContent = 'Out of moves'; st.classList.remove('think'); v.aiMove = null; v.ghost = []; return; }
  const sp = M.you.game.over ? M.speed : 1;
  if (c.phase === 'think') {
    st.textContent = 'Dreaming ahead'; st.classList.add('think');
    if (!c.pending) {
      c.pending = true; const tok = M.token;
      AI.move(g).then(res => { if (tok !== M.token) return; c.pending = false; c.res = res; c.phase = 'hold'; c.hold = 0; })
        .catch(() => { if (tok !== M.token) return; c.pending = false; c.phase = 'dead'; toast('The AI crashed. Try reloading.'); });
    }
  } else if (c.phase === 'hold') {
    st.classList.remove('think'); st.textContent = 'Planning move';
    v.ghost = c.res.plan || []; c.hold += dt * sp;
    if (c.hold >= .55) {
      if (c.res.none || !g.hand[c.res.i]) { c.phase = 'think'; return; }
      c.mv = { i: c.res.i, r: c.res.r, c: c.res.c, t: 0 }; v.aiMove = c.mv; c.phase = 'move'; Sfx.play('pick', .35);
    }
  } else if (c.phase === 'move') {
    st.textContent = 'Placing'; c.mv.t += dt * sp / .45;
    if (c.mv.t >= 1) {
      const info = v.commit(c.mv.i, c.mv.r, c.mv.c); v.aiMove = null; Sfx.onInfo(info, .35); c.phase = 'wait'; c.wait = 0;
    }
  } else if (c.phase === 'wait') { c.wait += dt * sp; if (c.wait >= .25) c.phase = 'think'; }
}
function checkEnd() {
  if (M.ended) return;
  const y = M.you.game;
  if (M.mode === 'solo') { if (y.over) finish('solo'); return; }
  const a = M.ai.game;
  if (y.over && a.over) finish(y.score > a.score ? 'win' : y.score < a.score ? 'lose' : 'draw');
  else if (a.over && y.score > a.score) finish('win');
}
async function finish(kind) {
  M.ended = true; M.running = false; M.you.locked = true; const tok = M.token;
  await sleep(1100); if (tok !== M.token) return;
  const y = M.you.game.score, a = M.ai ? M.ai.game.score : 0;
  const R = $('#result'); let title, kicker = 'Final', sub = '';
  if (kind === 'solo') {
    const prev = Stats.d.best, isBest = Stats.record('solo', y, 0);
    sub = isBest ? 'New personal best.' : 'Best: ' + prev.toLocaleString(); Sfx.play(isBest ? 'win' : 'over');
    title = 'Game over';
    $('#rScores').innerHTML = `<div class="win"><small>Score</small><b>${y.toLocaleString()}</b></div>`;
  } else {
    Stats.record(kind, y, a);
    title = kind === 'win' ? 'You win.' : kind === 'lose' ? 'AI wins.' : 'A draw.';
    kicker = kind === 'win' ? 'Human 1 · Machine 0' : kind === 'lose' ? 'Human 0 · Machine 1' : 'Evenly matched';
    sub = kind === 'win' ? `You beat it by ${(y - a).toLocaleString()}. Send the board to a friend.` : kind === 'lose' ? `It won by ${(a - y).toLocaleString()}. Same start, different pieces. Rematch?` : 'Identical scores. Rematch?';
    $('#rScores').innerHTML = `<div class="${kind === 'win' ? 'win' : 'lose'}"><small>You</small><b>${y.toLocaleString()}</b></div><div class="${kind === 'lose' ? 'win' : 'lose'}"><small>AI</small><b>${a.toLocaleString()}</b></div>`;
    Sfx.play(kind === 'win' ? 'win' : 'lose');
  }
  if (M.mode === 'vs' && QSCORE !== null && M.seed === QSEED) {
    sub = y > QSCORE ? `Challenge beaten. You topped their ${QSCORE.toLocaleString()} by ${(y - QSCORE).toLocaleString()}.`
      : y === QSCORE ? `Dead even with their ${QSCORE.toLocaleString()}.`
        : `Their ${QSCORE.toLocaleString()} still stands, ${(QSCORE - y).toLocaleString()} ahead of you.`;
  }
  const D = Stats.d;
  $('#rStats').innerHTML = `<div><b>${D.best.toLocaleString()}</b><small>Best</small></div>`
    + (M.mode === 'vs' ? `<div><b>${D.wins}–${D.losses}</b><small>Record</small></div><div><b>${D.streak}</b><small>Streak</small></div>`
      : `<div><b>${D.games}</b><small>Games</small></div>`);
  renderRecord();
  $('#rKicker').textContent = kicker; $('#rTitle').textContent = title; $('#rSub').textContent = sub;
  $('#rRematch').querySelector('span').textContent = kind === 'solo' ? 'Retry this board' : 'Rematch · same board';
  $('#rShare').hidden = false; R.hidden = false;
}
function frame(ts) {
  M.raf = requestAnimationFrame(frame);
  const dt = Math.min(.05, (ts - M.last) / 1000 || .016); M.last = ts; const t = ts / 1000;
  if (M.ai) M.ai.fog = false;
  for (const v of [M.you, M.ai]) if (v) { v.fx.update(dt, v.game.score); v.update(dt); v.draw(t); updateHUD(v); }
  if (M.ai) { const a = M.ai.game.score, y = M.you.game.score; $('.lead').style.setProperty('--lead', (y + a ? y / (y + a) : .5).toFixed(3)); }
  if (M.running) { aiStep(dt); checkEnd(); }
  updateSpectate();
}
async function countdown(tok) {
  const el = $('#countdown');
  for (const s of ['3', '2', '1', 'Go']) {
    if (tok !== M.token) return false;
    el.textContent = s; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    Sfx.tone(s === 'Go' ? 880 : 520, .12, .15, 'triangle'); await sleep(s === 'Go' ? 450 : 650);
  }
  el.textContent = ''; return tok === M.token;
}
async function begin() {                    // countdown, then go
  const tok = ++M.token; $('#result').hidden = true; M.ended = false; M.running = false;
  if (M.mode === 'vs') {
    const note = $('#gNote');
    if (!AI.ready) { note.textContent = 'Waking the AI…'; note.classList.add('show'); }
    const ok = await AI.whenReady(); note.classList.remove('show');
    if (tok !== M.token) return;
    if (!ok) { toast('AI failed to load: ' + (AI.err || 'unknown') + '. Serve over http(s), not file://'); await sleep(600); if (tok === M.token) exitGame(); return; }
    AI.reset(M.seed);
  }
  if (!(await countdown(tok))) return;
  M.you.locked = false; M.running = true;
}
function rematch(seed) { M.token++; newGames(seed); begin(); }

/* =========================================================
   TRANSITIONS
========================================================= */
const iris = $('#iris'); let savedScroll = 0;
async function irisIn(x, y) {
  iris.style.setProperty('--x', x + 'px'); iris.style.setProperty('--y', y + 'px'); iris.classList.remove('out'); void iris.offsetWidth;
  iris.classList.add('on'); await sleep(reduce ? 60 : 900);
}
async function irisOut() {
  iris.classList.add('out'); await sleep(reduce ? 60 : 650);
  iris.style.transition = 'none'; iris.classList.remove('on', 'out'); void iris.offsetWidth; iris.style.transition = '';
}
async function enterGame(mode, x, y) {
  if (M.busy) return; M.busy = true; Sfx.ensure();
  if (mode === 'vs') AI.init();
  let seed = QSEED !== null && mode === 'vs' ? QSEED : randomSeed();
  await irisIn(x, y);
  savedScroll = scrollY; M.mode = mode;
  $('#landing').style.display = 'none'; document.body.classList.add('in-game');
  $('#game').hidden = false; buildArena(mode); newGames(seed);
  if (!M.raf) { M.last = performance.now(); M.raf = requestAnimationFrame(frame); }
  await sleep(80); await irisOut(); M.busy = false; begin();
}
async function exitGame() {
  if (M.busy) return; M.busy = true; M.token++; M.running = false;
  const spec = $('#spec'); if (spec) spec.remove(); $('#arena').classList.remove('spectate');
  await irisIn(innerWidth / 2, innerHeight / 2);
  cancelAnimationFrame(M.raf); M.raf = 0; $('#game').hidden = true; $('#result').hidden = true; $('#countdown').textContent = '';
  document.body.classList.remove('in-game'); $('#landing').style.display = ''; window.scrollTo(0, savedScroll);
  renderRecord();
  await sleep(80); await irisOut(); M.busy = false;
}

/* =========================================================
   UI wiring
========================================================= */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
const QP = new URLSearchParams(location.search);
const QSEED = QP.has('seed') && /^\d+$/.test(QP.get('seed')) ? parseInt(QP.get('seed'), 10) : null;
const qnum = k => QP.has(k) && /^\d{1,7}$/.test(QP.get(k)) ? parseInt(QP.get(k), 10) : null;
const QSCORE = qnum('s'), QAI = qnum('a');

$$('.mode').forEach(b => b.addEventListener('click', e => { const r = b.getBoundingClientRect(); enterGame(b.dataset.mode, e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2); }));
$('#btnBack').addEventListener('click', exitGame);
$('#rMenu').addEventListener('click', exitGame);
$('#rRematch').addEventListener('click', () => rematch(M.seed));
$('#rNew').addEventListener('click', () => rematch(randomSeed()));
const SHARE_ICONS = {
  wa: '<path d="M3 21l1.6-4.8A8.5 8.5 0 1 1 8 19.5L3 21z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-.8.8c-1-.4-1.8-1.2-2.2-2.2l.8-.8-1-2L9 9.5z"/>',
  x: '<path d="M4 4l16 16M20 4L4 20"/>',
  tg: '<path d="M21 4L3 11l6 2 2 6 3-4 5 3L21 4z"/><path d="M9 13l12-9"/>',
  fb: '<path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V9H6.5v3.5H9V21h3.5v-8.5H15l.5-3.5h-3V6.5c0-.3.2-.5.5-.5H15V3z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/>',
  sms: '<path d="M4 5h16v11H9l-5 4V5z"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  dl: '<path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/>'
};
const shareSvg = key => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHARE_ICONS[key]}</svg>`;
const shareEncode = encodeURIComponent;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function shareData() {
  const vs = M.mode === 'vs', y = M.you.game.score, a = vs ? M.ai.game.score : null;
  const url = `${location.origin}${location.pathname}?seed=${M.seed}&s=${y}` + (vs ? `&a=${a}` : '');
  const text = vs
    ? `I scored ${y.toLocaleString()} against the AI on board #${pad6(M.seed)}. The AI got ${a.toLocaleString()}. Can you beat us both?`
    : `I scored ${y.toLocaleString()} on board #${pad6(M.seed)}. Can you beat it?`;
  return { vs, y, a, url, text };
}

async function makeCard() {
  try {
    await document.fonts.load('800 100px Inter');
  } catch (error) {
    console.warn('Could not load Inter for the share image; using a fallback font.', error);
  }
  const { vs, y, a, url } = shareData();
  const W = 1080, H = 1920, canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable; cannot create the share image.');
  const font = 'Inter,system-ui,-apple-system,sans-serif';
  const letterSpacing = px => { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; };
  const text = (value, x, yPos, size, color, weight = 800, spacing = 0) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    letterSpacing(spacing);
    ctx.fillText(value, x, yPos);
  };

  ctx.fillStyle = '#121211';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, -80, 0, W / 2, -80, 1300);
  glow.addColorStop(0, 'rgba(255,255,255,.12)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const markSize = 36, markGap = 8, markX = W / 2 - (markSize * 2 + markGap) / 2, markY = 110;
  [[0, 0, 1], [1, 1, 1], [1, 0, .3], [0, 1, .3]].forEach(([col, row, alpha]) => {
    rr(ctx, markX + col * (markSize + markGap), markY + row * (markSize + markGap), markSize, markSize, 11);
    ctx.fillStyle = `rgba(245,245,240,${alpha})`;
    ctx.fill();
  });
  text('BLOCK PUZZLE', W / 2, 262, 32, 'rgba(245,245,240,.7)', 700, 9);

  const headline = !vs ? 'MY SCORE' : y > a ? 'I BEAT THE AI' : y < a ? 'THE AI BEAT ME' : 'DEAD EVEN WITH THE AI';
  text(headline, W / 2, 400, 36, 'rgba(245,245,240,.56)', 700, 9);
  let scoreSize = 290;
  const scoreText = y.toLocaleString();
  ctx.font = `800 ${scoreSize}px ${font}`;
  letterSpacing(-scoreSize * .05);
  const measured = ctx.measureText(scoreText).width;
  if (measured > 900) scoreSize = Math.floor(scoreSize * 900 / measured);
  text(scoreText, W / 2, 565, scoreSize, '#f5f5f0', 800, -scoreSize * .05);
  text(vs ? `vs AI  ${a.toLocaleString()}` : 'Solo run', W / 2, 700, 46, 'rgba(245,245,240,.56)', 600);

  const cell = 90, boardX = (W - cell * 8) / 2, boardY = 800;
  rr(ctx, boardX - 30, boardY - 30, cell * 8 + 60, cell * 8 + 60, 56);
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 2;
  ctx.stroke();
  new Game(M.seed).board.forEach((value, index) => {
    const x = boardX + (index % 8) * cell, yPos = boardY + Math.floor(index / 8) * cell;
    if (value) drawBlock(ctx, x, yPos, cell, RGB[9]);
    else {
      rr(ctx, x + 5, yPos + 5, cell - 10, cell - 10, 22);
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.fill();
    }
  });
  text(`BOARD #${pad6(M.seed)}`, W / 2, boardY + cell * 8 + 82, 30, 'rgba(245,245,240,.5)', 700, 8);

  text('Can you beat it?', W / 2, 1670, 84, '#ffd08a', 800, -3);
  text(url.replace(/^https?:\/\//, '').replace(/\?.*$/, ''), W / 2, 1752, 34, 'rgba(245,245,240,.56)', 600);
  ctx.fillStyle = 'rgba(255,255,255,.1)';
  ctx.fillRect(W / 2 - 260, 1810, 520, 2);
  text('BLOCK PUZZLE  ·  ONYERIKAM', W / 2, 1860, 26, 'rgba(245,245,240,.4)', 700, 7);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The browser could not encode the share image.')), 'image/png');
  });
}

async function saveImage(button) {
  const label = $('em', button).textContent, status = $('em', button);
  button.disabled = true;
  status.textContent = 'Drawing…';
  const reset = () => setTimeout(() => {
    status.textContent = label;
    button.disabled = false;
    button.classList.remove('done');
  }, 1800);

  try {
    const blob = await makeCard(), { text, url } = shareData();
    const file = new File([blob], `block-puzzle-${pad6(M.seed)}.png`, { type: 'image/png' });
    if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Block Puzzle', text, url });
        status.textContent = 'Shared';
        button.classList.add('done');
      } catch (error) {
        if (error.name === 'AbortError') {
          status.textContent = label;
          button.disabled = false;
          return;
        }
        throw error;
      }
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      status.textContent = 'Saved';
      button.classList.add('done');
    }
  } catch (error) {
    console.error('Could not save the share image.', error);
    status.textContent = 'Could not save';
    toast('Could not save the image. Please try again.');
  }
  reset();
}

function openShare() {
  const { vs, y, a, url, text } = shareData();
  let box = $('#share');
  if (!box) {
    box = document.createElement('div');
    box.id = 'share';
    box.hidden = true;
    document.body.appendChild(box);
  }

  const cells = new Game(M.seed).board.map(value => `<i class="${value ? 'on' : ''}"></i>`).join('');
  const apps = [
    { n: 'WhatsApp', k: 'wa', c: '#25d366', h: `https://wa.me/?text=${shareEncode(text + ' ' + url)}` },
    { n: 'X', k: 'x', c: '#ffffff', h: `https://twitter.com/intent/tweet?text=${shareEncode(text)}&url=${shareEncode(url)}` },
    { n: 'Telegram', k: 'tg', c: '#2aabee', h: `https://t.me/share/url?url=${shareEncode(url)}&text=${shareEncode(text)}` },
    { n: 'Facebook', k: 'fb', c: '#4c8dff', h: `https://www.facebook.com/sharer/sharer.php?u=${shareEncode(url)}` },
    { n: 'Email', k: 'mail', c: '#ffd08a', h: `mailto:?subject=${shareEncode('Beat my Block Puzzle score')}&body=${shareEncode(text + '\n\n' + url)}` },
    { n: 'Messages', k: 'sms', c: '#8fe0c8', h: `sms:?&body=${shareEncode(text + ' ' + url)}` }
  ];
  if (navigator.share) apps.push({ n: 'More', k: 'more', c: '#b4c0ff', native: true });

  box.innerHTML = `
    <div class="sh-back"></div>
    <div class="sh-sheet" role="dialog" aria-modal="true" aria-label="Share your result">
      <span class="sh-grab" aria-hidden="true"></span>
      <button class="sh-x" type="button" aria-label="Close">${shareSvg('close')}</button>

      <div class="sh-card">
        <div class="mini sh-board" aria-hidden="true">${cells}</div>
        <div class="sh-info">
          <small>Board #${pad6(M.seed)}</small>
          <b>${y.toLocaleString()}</b>
          <span>${vs ? 'vs AI ' + a.toLocaleString() : 'Solo run'}</span>
        </div>
        <div class="sh-wm">
          <svg viewBox="0 0 64 64" width="12" height="12" aria-hidden="true"><rect x="6" y="6" width="26" height="26" rx="8" fill="currentColor"/><rect x="32" y="32" width="26" height="26" rx="8" fill="currentColor"/><rect x="32" y="6" width="26" height="26" rx="8" fill="currentColor" opacity=".3"/><rect x="6" y="32" width="26" height="26" rx="8" fill="currentColor" opacity=".3"/></svg>
          Block Puzzle · Onyerikam
        </div>
      </div>

      <div class="sh-apps">
        ${apps.map((app, index) => `<button class="sh-app" type="button" data-i="${index}" style="--c:${app.c};--i:${index}"><span class="sh-ico">${shareSvg(app.k)}</span><small>${app.n}</small></button>`).join('')}
      </div>

      <div class="sh-link">
        <span>${escapeHTML(url.replace(/^https?:\/\//, ''))}</span>
        <button class="sh-copy" type="button">${shareSvg('copy')}<em>Copy</em></button>
      </div>

      <button class="sh-save" type="button">${shareSvg('dl')}<em>Save image for stories</em></button>
    </div>`;

  clearTimeout(box._closeTimer);
  const close = () => {
    box.classList.remove('on');
    clearTimeout(box._closeTimer);
    box._closeTimer = setTimeout(() => {
      box.hidden = true;
      $('#rShare').focus();
    }, 450);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text + ' ' + url);
    } catch (error) {
      prompt('Copy this link', url);
      return;
    }
    const label = $('.sh-copy em', box), button = $('.sh-copy', box);
    label.textContent = 'Copied';
    button.classList.add('done');
    setTimeout(() => {
      label.textContent = 'Copy';
      button.classList.remove('done');
    }, 1600);
  };

  $('.sh-back', box).onclick = close;
  $('.sh-x', box).onclick = close;
  $('.sh-copy', box).onclick = copy;
  $('.sh-save', box).onclick = e => saveImage(e.currentTarget);
  $$('.sh-app', box).forEach(button => {
    button.onclick = async () => {
      const app = apps[Number(button.dataset.i)];
      if (!app.native) {
        window.open(app.h, '_blank', 'noopener');
        return;
      }
      try {
        await navigator.share({ title: 'Block Puzzle', text, url });
        close();
      } catch (error) {
        if (error.name !== 'AbortError') toast('Could not open the share menu.');
      }
    };
  });

  box._close = close;
  box.hidden = false;
  void box.offsetWidth;
  box.classList.add('on');
  $('.sh-x', box).focus();
}
$('#rShare').addEventListener('click', openShare);
$('#btnSound').addEventListener('click', () => {
  Sfx.ensure(); Sfx.on = !Sfx.on; $('#icoOn').style.display = Sfx.on ? '' : 'none'; $('#icoOff').style.display = Sfx.on ? 'none' : '';
});
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const share = $('#share');
  if (share && !share.hidden) {
    e.preventDefault();
    share._close();
  } else if (!$('#game').hidden) exitGame();
});

if (QSEED !== null) {
  const sc = QSCORE !== null;
  $('#challenge').innerHTML = `<b>Challenge received.</b> <span>Board #${pad6(QSEED)}. Same game, same start.</span>`
    + (sc ? `<div class="ch-scores"><div><small>Score to beat</small><b>${QSCORE.toLocaleString()}</b></div>`
      + (QAI !== null ? `<div><small>AI on this board</small><b>${QAI.toLocaleString()}</b></div>` : '') + `</div>` : '');
  $('#challenge').hidden = false;
  $('#pillText').textContent = sc ? `Beat ${QSCORE.toLocaleString()} on board #${pad6(QSEED)}` : 'Challenge received. Accept it';
  $('.mode.vs').classList.add('pulse');
  $('#heroCta span').textContent = 'Accept the challenge';
  const accept = e => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    enterGame('vs', e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2);
  };
  ['#heroCta', '#heroPill', '.nav-cta'].forEach(s => $(s).addEventListener('click', accept));
}

/* =========================================================
   LANDING: reveal, counters, spotlight, tilt, scroll fx
========================================================= */
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return; const el = e.target; if (el.dataset.d) el.style.transitionDelay = el.dataset.d + 'ms'; el.classList.add('in'); io.unobserve(el);
}), { threshold: .15 }) : null;
$$('.rv').forEach(el => io ? io.observe(el) : el.classList.add('in'));

const co = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return; co.unobserve(e.target); const el = e.target, to = +el.dataset.count, t0 = performance.now();
  (function tick(n) { const k = clamp((n - t0) / 1400, 0, 1); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 4))); if (k < 1) requestAnimationFrame(tick); })(t0);
}), { threshold: .6 }) : null;
$$('[data-count]').forEach(el => co ? co.observe(el) : el.textContent = el.dataset.count);

$$('.mini').forEach(m => {
  const r = Engine.mulberry32(+m.dataset.seed); let html = '';
  for (let i = 0; i < 64; i++) html += `<i class="${r() < .38 ? 'on' : ''}"></i>`; m.innerHTML = html;
});
document.addEventListener('pointermove', e => {
  const c = e.target.closest && e.target.closest('.card,.mode'); if (!c) return; const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
});
if (!coarse && !reduce) $$('.mag').forEach(b => {
  b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .18}px,${(e.clientY - r.top - r.height / 2) * .28}px)`; });
  b.addEventListener('pointerleave', () => b.style.transform = '');
});
const portrait = $('#portrait');
if (!coarse && !reduce) {
  portrait.addEventListener('pointermove', e => { const r = portrait.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; portrait.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`; });
  portrait.addEventListener('pointerleave', () => portrait.style.transform = '');
}

// scroll-linked word highlight
const mt = $('#manifestoText'); mt.innerHTML = mt.textContent.split(' ').map(w => `<span class="w">${w}</span>`).join(' ');
const words = $$('.w', mt), heroPin = $('#heroPin'), nav = $('#nav'), heroBottom = $('.hero-bottom'), heroTop = $('.hero-top'), cue = $('.scroll-cue');
let ticking = false;
function onScroll() {
  ticking = false; if (document.body.classList.contains('in-game')) return;
  const y = scrollY, vh = innerHeight, p = clamp(y / (vh * .75), 0, 1);
  if (!reduce) { heroPin.style.transform = `scale(${1 - .08 * p})`; heroPin.style.borderRadius = (p * 40) + 'px'; heroPin.style.opacity = 1 - .5 * p; }
  heroBottom.style.opacity = 1 - clamp(p * 2.2, 0, 1); heroTop.style.opacity = 1 - clamp(p * 2.2, 0, 1); cue.style.opacity = 1 - clamp(p * 4, 0, 1);
  nav.classList.toggle('scrolled', y > 30);
  const r = mt.getBoundingClientRect(), prog = clamp((vh * .85 - r.top) / (r.height + vh * .35), 0, 1) * words.length * 1.15;
  words.forEach((w, i) => w.style.opacity = clamp(.14 + (prog - i) * .86, .14, 1));
}
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
addEventListener('resize', onScroll); onScroll();

/* =========================================================
   HERO: a canvas scene, refracted by a liquid-glass lens (WebGL)
========================================================= */
function initHero() {
  const pin = $('#heroPin'), gl = $('#gl'), sc = $('#scene'), sctx = sc.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 1.75);
  let W = 0, H = 0, introT = reduce ? 1 : 0, introStart = 0, visible = true, raf = 0, last = 0, fontsOk = false;
  let g = null, tex = null, U = {};

  function drawScene(p) {
    const ctx = sctx; ctx.clearRect(0, 0, W, H); ctx.fillStyle = T.bgHex; ctx.fillRect(0, 0, W, H);
    const cell = Math.max(W, H * 1.2) / (coarse ? 8 : 15), rng = Engine.mulberry32(7), tints = T.tints;
    const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1, ox = (W - cols * cell) / 2, oy = (H - rows * cell) / 2;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const on = rng() < .16, tint = tints[Math.floor(rng() * 5)], x = ox + c * cell, y = oy + r * cell, d = Math.hypot(c - cols / 2, r - rows / 2) / Math.hypot(cols / 2, rows / 2);
      const k = clamp((p * 1.6 - d * .6), 0, 1);
      rr(ctx, x + cell * .06, y + cell * .06, cell * .88, cell * .88, cell * .2);
      ctx.fillStyle = on ? rgba(hex(tint), .17 * k) : `rgba(${T.ink},${.045 * k})`; ctx.fill();
    }
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .2, W / 2, H / 2, Math.max(W, H) * .75);
    vg.addColorStop(0, `rgba(${T.bg},0)`); vg.addColorStop(1, `rgba(${T.bg},.92)`); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    const fs = Math.min(W * (coarse ? .17 : .125), H * .2), lines = [['Same board.', T.fg], ['One winner.', T.dim]];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; if ('letterSpacing' in ctx) ctx.letterSpacing = (-fs * .04) + 'px';
    ctx.font = `800 ${fs}px Inter,system-ui,-apple-system,sans-serif`;
    lines.forEach(([txt, col], i) => {
      const lp = clamp((p - i * .18) / .6, 0, 1), e = 1 - Math.pow(1 - lp, 3);
      ctx.globalAlpha = e; ctx.fillStyle = col; ctx.fillText(txt, W / 2, H * .5 + (i - .5) * fs * 1.04 + (1 - e) * fs * .35);
    });
    ctx.globalAlpha = 1; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  function upload() {
    if (!g) return; g.bindTexture(g.TEXTURE_2D, tex);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, sc);
  }
  function size() {
    W = Math.max(2, Math.floor(pin.clientWidth * dpr)); H = Math.max(2, Math.floor(pin.clientHeight * dpr));
    sc.width = gl.width = W; sc.height = gl.height = H; drawScene(introT); if (g) { g.viewport(0, 0, W, H); upload(); }
  }

  g = gl.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false });
  if (g) {
    const vsrc = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fsrc = `precision highp float;
uniform sampler2D uTex;uniform vec2 uRes;uniform vec4 uL1;uniform vec2 uDir;uniform vec3 uL2;uniform float uLight;
float smin(float a,float b,float k){float h=max(k-abs(a-b),0.0)/k;return min(a,b)-h*h*k*0.25;}
float sdf(vec2 p){
  vec2 d=p-uL1.xy; vec2 u=vec2(dot(d,uDir),dot(d,vec2(-uDir.y,uDir.x)));
  u=vec2(u.x/(1.0+uL1.w),u.y*(1.0+uL1.w*0.5));
  float a=length(u)-uL1.z; float b=length(p-uL2.xy)-uL2.z;
  return smin(a,b,uL1.z*0.55);
}
void main(){
  vec2 p=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y); vec2 uv=p/uRes;
  vec3 base=texture2D(uTex,uv).rgb; float m=sdf(p);
  if(m>0.0){ float sh=smoothstep(uL1.z*0.4,0.0,m); gl_FragColor=vec4(base*(1.0-mix(0.3,0.09,uLight)*sh),1.0); return; }
  float depth=clamp(-m/(uL1.z*0.85),0.0,1.0); float edge=1.0-depth; float e=1.5;
  vec2 n=normalize(vec2(sdf(p+vec2(e,0.))-sdf(p-vec2(e,0.)),sdf(p+vec2(0.,e))-sdf(p-vec2(0.,e)))+1e-5);
  float disp=pow(edge,2.1)*uL1.z*0.6;
  vec2 o=n*disp;
  float r=texture2D(uTex,(p-o*0.9)/uRes).r;
  float gg=texture2D(uTex,(p-o)/uRes).g;
  float b=texture2D(uTex,(p-o*1.12)/uRes).b;
  vec3 col=vec3(r,gg,b);
  if(uLight>0.5){
    col*=0.965;
    col*=1.0-0.30*pow(edge,1.8);
    col=mix(col,col*vec3(0.90,0.94,1.0),smoothstep(0.55,1.0,edge)*0.5);
  }else{
    col=col*1.08+vec3(0.025);
  }
  vec2 L=normalize(vec2(-0.55,-0.85));
  float s1=pow(max(dot(n,L),0.0),2.5)*smoothstep(0.5,1.0,edge);
  float s2=pow(max(dot(n,-L),0.0),4.0)*smoothstep(0.7,1.0,edge)*0.5;
  col+=vec3(s1*0.55+s2*0.22);
  col+=smoothstep(0.93,1.0,edge)*(uLight>0.5?-0.10:0.10);
  float aa=smoothstep(0.0,-1.6,m);
  gl_FragColor=vec4(mix(base,col,aa),1.0);
}`;
    const sh = (t, s) => { const o = g.createShader(t); g.shaderSource(o, s); g.compileShader(o); return g.getShaderParameter(o, g.COMPILE_STATUS) ? o : (console.warn(g.getShaderInfoLog(o)), null); };
    const v = sh(g.VERTEX_SHADER, vsrc), f = sh(g.FRAGMENT_SHADER, fsrc), prog = g.createProgram();
    if (v && f) {
      g.attachShader(prog, v); g.attachShader(prog, f); g.linkProgram(prog);
      if (g.getProgramParameter(prog, g.LINK_STATUS)) {
        g.useProgram(prog); const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf);
        g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
        const loc = g.getAttribLocation(prog, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
        ['uTex', 'uRes', 'uL1', 'uDir', 'uL2', 'uLight'].forEach(n => U[n] = g.getUniformLocation(prog, n));
        tex = g.createTexture(); g.bindTexture(g.TEXTURE_2D, tex);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      } else g = null;
    } else g = null;
  }
  if (!g) { sc.style.display = 'block'; gl.style.display = 'none'; }

  const L = { x: 0, y: 0, vx: 0, vy: 0, x2: 0, y2: 0, vx2: 0, vy2: 0, R: 0, press: 0, tx: 0, ty: 0, last: -9999, init: false };
  const bounds = () => pin.getBoundingClientRect();
  pin.addEventListener('pointermove', e => { const r = bounds(); L.tx = (e.clientX - r.left) * dpr; L.ty = (e.clientY - r.top) * dpr; L.last = performance.now(); });
  pin.addEventListener('pointerdown', e => { const r = bounds(); L.tx = (e.clientX - r.left) * dpr; L.ty = (e.clientY - r.top) * dpr; L.last = performance.now(); L.press = 1; });
  addEventListener('pointerup', () => L.press = 0);

  function loop(ts) {
    if (!visible) { raf = 0; return; } raf = requestAnimationFrame(loop);
    const dt = Math.min(.033, (ts - last) / 1000 || .016); last = ts; const t = ts / 1000;
    if (introT < 1) { introT = clamp((ts - introStart) / 1700, 0, 1); drawScene(introT); upload(); }
    if (!g) return;
    const base = clamp(Math.min(W, H) * (coarse ? .2 : .17), 80 * dpr, 200 * dpr);
    if (!L.init) { L.x = L.x2 = L.tx = W / 2; L.y = L.y2 = L.ty = H / 2; L.R = base; L.init = true; }
    let tx = L.tx, ty = L.ty;
    if (performance.now() - L.last > 2600 && !reduce) { tx = W * .5 + Math.cos(t * .55) * W * .2; ty = H * .5 + Math.sin(t * .8) * H * .13; }
    const spring = (pos, vel, target, k, c) => { const a = k * (target - pos) - c * vel; vel += a * dt; return [pos + vel * dt, vel]; };
    if (reduce) { L.x = tx; L.y = ty; L.vx = L.vy = 0; }
    else { [L.x, L.vx] = spring(L.x, L.vx, tx, 190, 22); [L.y, L.vy] = spring(L.y, L.vy, ty, 190, 22); }
    const ox = Math.cos(t * .9) * base * 1.25, oy = Math.sin(t * 1.1) * base * 1.0;
    [L.x2, L.vx2] = spring(L.x2, L.vx2, L.x + ox, 60, 12); [L.y2, L.vy2] = spring(L.y2, L.vy2, L.y + oy, 60, 12);
    L.R += (base * (1 + .25 * L.press) - L.R) * Math.min(1, dt * 10);
    const sp = Math.hypot(L.vx, L.vy) / dpr, s = reduce ? 0 : clamp(sp / 1800, 0, .4);
    const dx = sp > 1 ? L.vx / Math.hypot(L.vx, L.vy) : 1, dy = sp > 1 ? L.vy / Math.hypot(L.vx, L.vy) : 0;
    g.uniform1i(U.uTex, 0); g.uniform2f(U.uRes, W, H); g.uniform4f(U.uL1, L.x, L.y, L.R, s); g.uniform2f(U.uDir, dx, dy);
    g.uniform3f(U.uL2, L.x2, L.y2, L.R * .42);
    g.uniform1f(U.uLight, isLight() ? 1 : 0);
    g.drawArrays(g.TRIANGLES, 0, 3);
  }
  const start = () => { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting && !document.body.classList.contains('in-game'); if (visible) start(); }).observe(pin);
  addEventListener('resize', size);
  addEventListener('themechange', () => { drawScene(introT); upload(); });
  size();
  const go = () => { introStart = performance.now(); if (reduce) { introT = 1; } drawScene(introT); upload(); start(); };
  (document.fonts && document.fonts.load ? document.fonts.load('800 80px Inter').catch(() => {}) : Promise.resolve()).then(() => { fontsOk = true; size(); window.__heroGo = go; });
}
initHero();

/* loader */
function hideLoader() { $('#loader').classList.add('done'); if (window.__heroGo) window.__heroGo(); else setTimeout(() => window.__heroGo && window.__heroGo(), 200); }
const loaded = new Promise(r => document.readyState === 'complete' ? r() : addEventListener('load', r));
Promise.all([loaded, sleep(900)]).then(() => { hideLoader(); setTimeout(() => AI.init(), 1200); });   // start loading the model while they read
})();
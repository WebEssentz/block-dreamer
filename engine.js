(function (root) {
  'use strict';
  const GRID = 8, START_FILL = 0.35;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // stream 0 = board, stream 1+n = the n-th hand.
  const seedFor = (seed, idx) => mulberry32((seed >>> 0) + Math.imul(idx + 1, 0x9E3779B1));
  const aiSeedOf = seed => (Math.imul(seed >>> 0, 2654435761) + 40503) >>> 0;

  function normalize(cells) {
    const mr = Math.min(...cells.map(p => p[0])), mc = Math.min(...cells.map(p => p[1]));
    return cells.map(([r, c]) => [r - mr, c - mc]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  const rotate = cells => normalize(cells.map(([r, c]) => [c, -r]));
  const rect = (h, w) => { const o = []; for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) o.push([r, c]); return o; };

  const BASES = [
    [[[0,0]], 6], [[[0,0],[0,1]], 6], [[[0,0],[0,1],[0,2]], 6],
    [[[0,0],[1,1]], 3], [[[0,0],[1,1],[2,2]], 3],
    [[[0,0],[0,1],[0,2],[0,3]], 4], [[[0,0],[0,1],[0,2],[0,3],[0,4]], 4],
    [rect(2,2), 3], [rect(3,3), 3], [rect(2,3), 4],
    [[[0,0],[1,0],[1,1]], 3],
    [[[0,0],[1,0],[2,0],[2,1],[2,2]], 4],
    [[[0,0],[1,0],[2,0],[2,1]], 4],
    [[[0,1],[1,1],[2,1],[2,0]], 4],
    [[[0,0],[1,0],[2,0],[3,0],[3,1]], 4],
    [[[0,1],[1,1],[2,1],[3,1],[3,0]], 4],
    [[[0,0],[0,2],[1,0],[1,1],[1,2]], 4],
    [[[0,0],[0,1],[0,2],[1,1]], 4],
    [[[0,1],[0,2],[1,0],[1,1]], 4],
    [[[0,0],[0,1],[1,1],[1,2]], 4],
  ];

  const SHAPES = [];            // {cells, w}  (same order as the python SHAPE_LIST)
  for (const [base, w] of BASES) {
    const seen = new Set(); let cur = normalize(base);
    for (let i = 0; i < 4; i++) {
      const k = JSON.stringify(cur);
      if (!seen.has(k)) { seen.add(k); SHAPES.push({ cells: cur, w }); }
      cur = rotate(cur);
    }
  }
  const N_SHAPES = SHAPES.length;
  const TOTAL_W = SHAPES.reduce((s, x) => s + x.w, 0);

  function pickShape(rng) {
    let r = rng() * TOTAL_W, up = 0;
    for (let i = 0; i < N_SHAPES; i++) { up += SHAPES[i].w; if (r <= up) return i; }
    return N_SHAPES - 1;
  }
  function randomPiece(rng) {
    const sid = pickShape(rng);
    return { sid, cells: SHAPES[sid].cells, color: 1 + Math.floor(rng() * 5) };
  }
  const pieceSize = cells => [Math.max(...cells.map(p => p[0])) + 1, Math.max(...cells.map(p => p[1])) + 1];

  function fits(board, cells, r, c) {
    for (const [dr, dc] of cells) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= GRID || cc < 0 || cc >= GRID || board[rr * GRID + cc]) return false;
    }
    return true;
  }
  function fitsAnywhere(board, cells) {
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (fits(board, cells, r, c)) return true;
    return false;
  }
  function hasMove(board, hand) {
    for (const p of hand) if (p && fitsAnywhere(board, p.cells)) return true;
    return false;
  }

  class Game {
    constructor(seed, opts = {}) {
      this.seed = seed >>> 0;
      this.altSeed = opts.altSeed === undefined ? null : opts.altSeed >>> 0;
      this.reset();
    }
    reset() {
      const rng = seedFor(this.seed, 0);
      this.board = this.randomBoard(rng);
      this.score = 0; this.over = false; this.combo = 0; this.miss = 0; this.handIdx = 0;
      this.hand = this.newHand();
    }
    randomBoard(rng) {
      for (;;) {
        const b = Array.from({ length: 64 }, () => rng() < START_FILL ? 9 : 0);
        let bad = false;
        for (let a = 0; a < GRID && !bad; a++) {
          let rowFull = true, colFull = true;
          for (let b2 = 0; b2 < GRID; b2++) { if (!b[a * 8 + b2]) rowFull = false; if (!b[b2 * 8 + a]) colFull = false; }
          if (rowFull || colFull) bad = true;
        }
        if (!bad) return b;
      }
    }
    newHand() {
      const base = this.altSeed !== null && this.handIdx >= 1 ? this.altSeed : this.seed;
      const rng = seedFor(base, 1 + this.handIdx);
      let hand;
      for (let i = 0; i < 500; i++) {
        hand = [randomPiece(rng), randomPiece(rng), randomPiece(rng)];
        if (hand.every(p => fitsAnywhere(this.board, p.cells))) return hand;
      }
      for (let i = 0; i < 300; i++) {
        hand = [randomPiece(rng), randomPiece(rng), randomPiece(rng)];
        if (hasMove(this.board, hand)) return hand;
      }
      return hand;
    }
    canPlace(i, r, c) { const p = this.hand[i]; return !!p && fits(this.board, p.cells, r, c); }
    place(i, r, c) {
      const p = this.hand[i], cells = p.cells, placed = [], cleared = [];
      let gain = cells.length;
      for (const [dr, dc] of cells) { const rr = r + dr, cc = c + dc; placed.push([rr, cc]); this.board[rr * 8 + cc] = p.color; }
      const rows = [], cols = [];
      for (let a = 0; a < 8; a++) {
        let rf = true, cf = true;
        for (let b = 0; b < 8; b++) { if (!this.board[a * 8 + b]) rf = false; if (!this.board[b * 8 + a]) cf = false; }
        if (rf) rows.push(a); if (cf) cols.push(a);
      }
      const n = rows.length + cols.length;
      let boardClear = false;
      if (n) {
        const spots = new Set();
        rows.forEach(a => { for (let b = 0; b < 8; b++) spots.add(a * 8 + b); });
        cols.forEach(b => { for (let a = 0; a < 8; a++) spots.add(a * 8 + b); });
        spots.forEach(s => { cleared.push([s >> 3, s & 7, p.color]); this.board[s] = 0; });
        this.combo++; this.miss = 0;
        gain += 10 * n * n * this.combo;
        boardClear = this.board.every(v => !v);
        if (boardClear) gain += 200;
      } else { this.miss++; if (this.miss >= 3) this.combo = 0; }
      this.score += gain;
      this.hand[i] = null;
      if (this.hand.every(x => !x)) { this.handIdx++; this.hand = this.newHand(); }
      if (!hasMove(this.board, this.hand)) this.over = true;
      return { gain, lines: n, combo: this.combo, cleared, placed, boardClear, rainbow: n >= 2 };
    }
  }

  root.Engine = { GRID, SHAPES, N_SHAPES, mulberry32, seedFor, aiSeedOf, Game, pieceSize, fits, fitsAnywhere, hasMove };
})(self);
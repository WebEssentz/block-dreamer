# block-dreamer

> A 711 KB neural network that dreams ahead to beat you at blocks.

Live demo → **[blockpuzzle.onyerikam.com](https://blockpuzzle.onyerikam.com/)** · Play solo or go head-to-head against the AI in your browser. No install. No server. No accounts.

---

## What it is

A block puzzle game with a trained RL agent that plays it better than I do — and I made the game.

The AI doesn't just pick the best-looking move. Before every placement it **dreams**: it simulates every possible move from the current board, imagines several future hands the game might deal next, and picks the plan with the highest expected value across all of them. The result is an agent that sets up 5-line clears, sustains x100 combos, and makes moves that look wrong until three pieces later they aren't.

It runs entirely in your browser via ONNX + WebAssembly. The model is 711 KB.

---

## How it works

### The game

- 8×8 board, three pieces in hand at a time
- Place a piece, clear full rows or columns, score points
- Miss three placements in a row without clearing → combo resets
- No moves left → game over

### The dreamer (the interesting part)

Every time the AI sees a board it does two things:

1. **Dream features** — for every legal move (up to 192), it simulates the resulting board and computes:
   - lines cleared
   - points gained
   - how many future piece shapes still fit afterwards
   - whether the remaining hand pieces still fit
   - board fill percentage

   These become extra input maps fed into the network alongside the raw board state.

2. **Beam search planning** — before moving, it plans the entire 3-piece hand in every order using beam search (beam=8, top-8 moves per step), judging the end of each plan by averaging the network's value over sampled future hands. It follows the best plan, checks reality against the dream after each move, and replans only if they diverge.

### The network

A recurrent-depth latent reasoner (~711 KB):

- **Embed** → spatial CNN + vector MLP fused together
- **Core block** looped K times (K=2–8, random during training, fixed at 8 for play) — same weights, more loops = more thinking per move
- **Policy head** — one logit map per hand slot + direct shortcut from dream features
- **Value head** — global average + max pooling → MLP → scalar

### Training

- **Environment** — 4096 games simulated in parallel on GPU using pure tensor ops (exact game rules, no approximation)
- **Algorithm** — PPO with GAE, reward normalisation, potential-based shaping for board openness, rank bonus for beating recent top-25% of games
- **Scale** — ~60 million games on an NVIDIA B300 (Blackwell Ultra)
- **Result** — avg score ~3,800+, max observed 88,368+, x100 combos

### Stack

| Stage | Tools |
| --- | --- |
| Game + training | Python, PyTorch |
| Export | ONNX |
| Browser inference | WebAssembly (ONNX Runtime Web) |
| Frontend | Vanilla JS |

---

## Results

| Score | Result |
| --- | --- |
| Human best (me) | ~1,000 |
| AI average (last 500 games) | ~3,800 |
| AI best observed | 88,368 |
| Best combo | x100 |

The AI averages roughly 3–4× my best score. It hasn't peaked — training stopped at 60M games due to compute budget.

---

## Repo structure

```text
block-dreamer/
├── index.html       # Entry point
├── style.css        # Styles
├── app.js           # Game logic + UI
├── engine.js        # Board engine
├── ai-worker.js     # AI runs in a background thread
├── model.onnx       # Exported model (ONNX)
└── model.json       # Model config
```

The trained weights are not published. The architecture and training code are described above — you can train your own.

---

## Run it locally

```sh
git clone https://github.com/onyerikam/block-dreamer
cd block-dreamer
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser. No build step, no dependencies.

---

## The vs mode

Same board. Same opening hand. Once those pieces are played, you and the AI draw from different random pools — so you can watch it live without being able to copy it.

---

Built, trained & shipped solo by [Onyerikam](https://github.com/WebEssentz) · 2026

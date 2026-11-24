// Live OTA (Over-The-Air) Updater for Block Dreamer
// Checks GitHub for updates when online and syncs web bundle automatically.

const UPDATER_REPO = 'WebEssentz/block-dreamer';
const UPDATER_BRANCH = 'mobile-app';
const VERSION_URL = `https://raw.githubusercontent.com/${UPDATER_REPO}/${UPDATER_BRANCH}/version.json`;
const RAW_BASE = `https://raw.githubusercontent.com/${UPDATER_REPO}/${UPDATER_BRANCH}/`;

const Updater = {
  currentVersion: '1.0.1',
  currentCommit: '',
  currentTimestamp: 0,
  checking: false,
  downloadedReady: false,

  async init() {
    try {
      const bundled = window.__BD_BUNDLED__ || null;
      const storedRaw = localStorage.getItem('bd_version');
      const stored = storedRaw ? JSON.parse(storedRaw) : null;
      const baseline = (stored && stored.timestamp) ? stored : bundled;

      if (baseline) {
        this.currentVersion = baseline.version || this.currentVersion;
        this.currentCommit = baseline.commit || '';
        this.currentTimestamp = baseline.timestamp || 0;
      }
    } catch (_) {}

    this.updateUI();

    // If online, check after boot settles; otherwise wait until device comes online
    if (navigator.onLine) {
      setTimeout(() => this.check(false), 3000);
    } else {
      window.addEventListener('online', () => {
        setTimeout(() => this.check(false), 1000);
      }, { once: true });
    }
  },

  updateUI(statusText, btnText) {
    const vEl = document.getElementById('mhAppVersion');
    if (vEl) vEl.textContent = `v${this.currentVersion}`;
    const sEl = document.getElementById('mhUpdateStatusText');
    if (sEl && statusText) sEl.textContent = statusText;
    const smV = document.getElementById('smVersionDesc');
    if (smV) smV.textContent = `v${this.currentVersion} · 711 KB On-Device Neural Net`;
    const smBtn = document.getElementById('smBtnCheckUpdate');
    if (smBtn && btnText) {
      const span = smBtn.querySelector('span');
      if (span) span.textContent = btnText;
    }
  },

  async check(manual = false) {
    if (this.downloadedReady) {
      window.location.reload();
      return;
    }
    if (this.checking) return;
    if (!navigator.onLine) {
      this.updateUI('Offline', 'Check Now');
      if (manual) this.toast('Offline. Will check automatically when online.');
      window.addEventListener('online', () => {
        setTimeout(() => this.check(false), 1000);
      }, { once: true });
      return;
    }

    this.checking = true;
    const spin = document.getElementById('mhUpdateSpinIco');
    if (spin) spin.style.animation = 'spin 1s linear infinite';
    this.updateUI('Checking updates...', 'Checking...');

    try {
      const res = await fetch(`${VERSION_URL}?_t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Network error');
      const remote = await res.json();

      const localTs = this.getLocalTimestamp();
      const hasUpdate = !!(remote.timestamp && Number(remote.timestamp) > localTs);

      if (hasUpdate) {
        this.updateUI('Downloading update...', 'Updating...');
        await this.downloadUpdate(remote);
      } else {
        this.updateUI('App up to date', 'Up to Date');
        if (manual) this.toast('Block Dreamer is up to date.');
        setTimeout(() => this.updateUI(null, 'Check Now'), 2500);
      }
    } catch (err) {
      console.warn('OTA check failed:', err);
      this.updateUI('Check for Updates', 'Check Now');
      if (manual) this.toast('Could not reach GitHub.');
    } finally {
      this.checking = false;
      if (spin) spin.style.animation = '';
    }
  },

  getLocalTimestamp() {
    try {
      const s = localStorage.getItem('bd_version');
      const storedTs = s ? (Number(JSON.parse(s).timestamp) || 0) : 0;
      const bundledTs = (window.__BD_BUNDLED__ && Number(window.__BD_BUNDLED__.timestamp)) || 0;
      return Math.max(storedTs, bundledTs, this.currentTimestamp || 0);
    } catch (_) {
      return this.currentTimestamp || 0;
    }
  },

  async downloadUpdate(remote) {
    try {
      const q = `?_t=${Date.now()}`;
      const [htmlRes, cssRes, engineRes, updaterRes, jsRes] = await Promise.all([
        fetch(`${RAW_BASE}index.html${q}`, { cache: 'no-store' }),
        fetch(`${RAW_BASE}style.css${q}`, { cache: 'no-store' }),
        fetch(`${RAW_BASE}engine.js${q}`, { cache: 'no-store' }),
        fetch(`${RAW_BASE}updater.js${q}`, { cache: 'no-store' }),
        fetch(`${RAW_BASE}app.js${q}`, { cache: 'no-store' })
      ]);

      if (!htmlRes.ok || !cssRes.ok || !engineRes.ok || !updaterRes.ok || !jsRes.ok) {
        throw new Error('Asset download failed');
      }

      const [html, css, engine, updaterJs, js] = await Promise.all([
        htmlRes.text(),
        cssRes.text(),
        engineRes.text(),
        updaterRes.text(),
        jsRes.text()
      ]);

      const startTag = '<!-- BD_UI_START -->';
      const endTag = '<!-- BD_UI_END -->';
      const sIdx = html.indexOf(startTag);
      const eIdx = html.indexOf(endTag);
      const uiHtml = (sIdx !== -1 && eIdx !== -1 && eIdx > sIdx)
        ? html.slice(sIdx + startTag.length, eIdx)
        : '';

      if (css.length < 5000 || js.length < 5000 || engine.length < 1000 ||
          updaterJs.length < 500 || !uiHtml.includes('id="mobileHome"') || !uiHtml.includes('id="game"')) {
        throw new Error('Downloaded OTA bundle failed integrity validation');
      }

      localStorage.setItem('bd_live_html', uiHtml);
      localStorage.setItem('bd_live_css', css);
      localStorage.setItem('bd_live_engine', engine);
      localStorage.setItem('bd_live_updater', updaterJs);
      localStorage.setItem('bd_live_js', js);
      localStorage.removeItem('bd_ota_fail');
      localStorage.setItem('bd_version', JSON.stringify({
        version: remote.version || this.currentVersion,
        commit: remote.commit || '',
        timestamp: Number(remote.timestamp) || Date.now()
      }));

      this.currentVersion = remote.version || this.currentVersion;
      this.currentCommit = remote.commit || '';
      this.currentTimestamp = Number(remote.timestamp) || Date.now();
      this.downloadedReady = true;
      this.updateUI(`v${this.currentVersion} ready`, 'Restart');

      const smChip = document.querySelector('.sm-status-chip');
      if (smChip) smChip.textContent = 'Update Ready';

      this.promptRestart();
    } catch (err) {
      console.error('Failed to download update:', err);
      this.updateUI('Update failed', 'Retry');
      if (typeof window.toast === 'function') window.toast('Update download failed.');
    }
  },

  promptRestart() {
    if (document.querySelector('.ota-banner')) return;
    const banner = document.createElement('div');
    banner.className = 'ota-banner glass';
    banner.innerHTML = `
      <div class="ota-content">
        <span class="ota-title">✨ Update Ready</span>
        <span class="ota-desc">Restart now to apply v${this.currentVersion}</span>
      </div>
      <button class="ota-btn" type="button">Restart</button>
    `;
    banner.querySelector('button').addEventListener('click', () => {
      window.location.reload();
    });
    document.body.appendChild(banner);
  },

  toast(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
  }
};

window.Updater = Updater;

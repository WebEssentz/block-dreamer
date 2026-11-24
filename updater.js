// Live OTA (Over-The-Air) Updater for Block Dreamer
// Checks GitHub for updates when online and syncs web bundle automatically.

const UPDATER_REPO = 'WebEssentz/block-dreamer';
const UPDATER_BRANCH = 'mobile-app';
const VERSION_URL = `https://raw.githubusercontent.com/${UPDATER_REPO}/${UPDATER_BRANCH}/version.json`;
const RAW_BASE = `https://raw.githubusercontent.com/${UPDATER_REPO}/${UPDATER_BRANCH}/`;

const Updater = {
  currentVersion: '1.0.1',
  currentCommit: '',
  checking: false,

  async init() {
    try {
      const storedVer = localStorage.getItem('bd_version');
      if (storedVer) {
        const v = JSON.parse(storedVer);
        this.currentVersion = v.version || this.currentVersion;
        this.currentCommit = v.commit || '';
      }
    } catch (_) {}

    this.updateUI();

    // If online, check now; otherwise wait until online
    if (navigator.onLine) {
      setTimeout(() => this.check(), 3000);
    } else {
      window.addEventListener('online', () => {
        setTimeout(() => this.check(), 1000);
      }, { once: true });
    }
  },

  updateUI(statusText) {
    const vEl = document.getElementById('mhAppVersion');
    if (vEl) vEl.textContent = `v${this.currentVersion}`;
    const sEl = document.getElementById('mhUpdateStatusText');
    if (sEl && statusText) sEl.textContent = statusText;
  },

  async check(manual = false) {
    if (this.checking) return;
    if (!navigator.onLine) {
      if (manual) this.toast('Offline. Will check when connected.');
      return;
    }

    this.checking = true;
    const spin = document.getElementById('mhUpdateSpinIco');
    if (spin) spin.style.animation = 'spin 1s linear infinite';
    this.updateUI('Checking updates...');

    try {
      const res = await fetch(`${VERSION_URL}?_t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Network error');
      const remote = await res.json();

      const hasUpdate = (remote.commit && remote.commit !== this.currentCommit) ||
                        (remote.timestamp && remote.timestamp > (this.getLocalTimestamp()));

      if (hasUpdate) {
        this.updateUI('Downloading update...');
        await this.downloadUpdate(remote);
      } else {
        this.updateUI('App up to date');
        if (manual) this.toast('Block Dreamer is up to date.');
      }
    } catch (err) {
      console.warn('OTA check failed:', err);
      this.updateUI('Up to date');
      if (manual) this.toast('Could not reach GitHub.');
    } finally {
      this.checking = false;
      if (spin) spin.style.animation = '';
    }
  },

  getLocalTimestamp() {
    try {
      const s = localStorage.getItem('bd_version');
      return s ? (JSON.parse(s).timestamp || 0) : 0;
    } catch (_) {
      return 0;
    }
  },

  async downloadUpdate(remote) {
    try {
      // Fetch updated style.css and app.js
      const [cssRes, jsRes] = await Promise.all([
        fetch(`${RAW_BASE}style.css?_t=${Date.now()}`),
        fetch(`${RAW_BASE}app.js?_t=${Date.now()}`)
      ]);

      if (!cssRes.ok || !jsRes.ok) throw new Error('Asset download failed');

      const css = await cssRes.text();
      const js = await jsRes.text();

      // Store in localStorage for instant offline injection on next launch
      localStorage.setItem('bd_live_css', css);
      localStorage.setItem('bd_live_js', js);
      localStorage.setItem('bd_version', JSON.stringify({
        version: remote.version || this.currentVersion,
        commit: remote.commit || '',
        timestamp: remote.timestamp || Date.now()
      }));

      this.currentVersion = remote.version || this.currentVersion;
      this.currentCommit = remote.commit || '';
      this.updateUI(`v${this.currentVersion} ready`);

      this.promptRestart();
    } catch (err) {
      console.error('Failed to download update:', err);
      this.updateUI('Update failed');
    }
  },

  promptRestart() {
    const banner = document.createElement('div');
    banner.className = 'ota-banner glass';
    banner.innerHTML = `
      <div class="ota-content">
        <span class="ota-title">✨ Update Ready</span>
        <span class="ota-desc">Restart now to apply the latest changes</span>
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

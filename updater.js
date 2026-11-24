// Native Android APK Self-Updater for Block Dreamer
// Checks GitHub Releases (`latest-apk`), downloads the signed APK in-app,
// and launches Android's native system installer to replace the app cleanly.

const UPDATER_REPO = 'WebEssentz/block-dreamer';
const RELEASE_API = `https://api.github.com/repos/${UPDATER_REPO}/releases/tags/latest-apk`;
const DEFAULT_APK_URL = `https://github.com/${UPDATER_REPO}/releases/download/latest-apk/app-debug.apk`;

function parseSemver(v) {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareSemver(a, b) {
  const pa = parseSemver(a), pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

const Updater = {
  currentVersion: '1.0.4',
  checking: false,
  installing: false,
  available: null,

  getPlugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppUpdater
      ? window.Capacitor.Plugins.AppUpdater
      : null;
  },

  async init() {
    const bundled = window.__BD_BUNDLED__ || null;
    if (bundled && bundled.version) {
      this.currentVersion = bundled.version;
    }

    const plugin = this.getPlugin();
    if (plugin) {
      try {
        const info = await plugin.getInstalledVersion();
        if (info && info.version) this.currentVersion = info.version;
      } catch (_) {}

      try {
        plugin.addListener('downloadProgress', (ev) => {
          this.onProgress(ev);
        });
      } catch (_) {}
    }

    this.updateUI();

    if (navigator.onLine) {
      setTimeout(() => this.check(false), 2500);
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
    if (smV) smV.textContent = `v${this.currentVersion}`;
    const smBtn = document.getElementById('smBtnCheckUpdate');
    if (smBtn && btnText) {
      const span = smBtn.querySelector('span');
      if (span) span.textContent = btnText;
    }
  },

  onProgress(ev) {
    if (!ev) return;
    const pct = typeof ev.progress === 'number' && ev.progress >= 0 ? ev.progress : null;
    const mb = ev.downloaded ? (ev.downloaded / 1048576).toFixed(1) : '0.0';
    const totalMb = ev.total > 0 ? (ev.total / 1048576).toFixed(1) : null;
    const label = pct !== null ? `Downloading ${pct}%` : `Downloading ${mb} MB`;

    this.updateUI(label, label);
    const bar = document.querySelector('.ota-progress i');
    if (bar && pct !== null) bar.style.width = `${pct}%`;
    const desc = document.querySelector('.ota-desc');
    if (desc) desc.textContent = totalMb ? `${mb} / ${totalMb} MB` : `${mb} MB downloaded`;
    const btn = document.querySelector('.ota-btn');
    if (btn) btn.textContent = pct !== null ? `${pct}%` : '…';
  },

  async check(manual = false) {
    if (this.installing) return;
    if (this.available) {
      await this.installUpdate();
      return;
    }
    if (this.checking) return;

    if (!navigator.onLine) {
      this.updateUI('Offline', 'Check for Update');
      if (manual) this.toast('Offline. Will check automatically when online.');
      window.addEventListener('online', () => {
        setTimeout(() => this.check(false), 1000);
      }, { once: true });
      return;
    }

    this.checking = true;
    const spin = document.getElementById('mhUpdateSpinIco');
    if (spin) spin.style.animation = 'spin 1s linear infinite';
    this.updateUI('Checking...', 'Checking...');

    try {
      const res = await fetch(`${RELEASE_API}?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Accept': 'application/vnd.github+json' }
      });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const rel = await res.json();

      const m = String(rel.name || '').match(/v?(\d+\.\d+\.\d+)/);
      const remoteVersion = m ? m[1] : null;
      const asset = Array.isArray(rel.assets)
        ? rel.assets.find(a => a && a.name && a.name.endsWith('.apk'))
        : null;
      const apkUrl = (asset && asset.browser_download_url) || DEFAULT_APK_URL;
      const sizeMb = asset && asset.size ? (asset.size / 1048576).toFixed(1) : null;

      if (remoteVersion && compareSemver(remoteVersion, this.currentVersion) > 0) {
        this.available = { version: remoteVersion, url: apkUrl, sizeMb };
        this.updateUI(`Update v${remoteVersion}`, `Install v${remoteVersion}`);
        this.showUpdateBanner();
        if (manual) this.toast(`v${remoteVersion} available — tap Install.`);
      } else {
        this.updateUI('Up to date', 'Up to Date');
        if (manual) this.toast(`v${this.currentVersion} is up to date.`);
        setTimeout(() => {
          if (!this.available && !this.installing) this.updateUI('Check for Updates', 'Check for Update');
        }, 2500);
      }
    } catch (err) {
      console.warn('Update check failed:', err);
      this.updateUI('Check for Updates', 'Check for Update');
      if (manual) this.toast('Could not reach GitHub.');
    } finally {
      this.checking = false;
      if (spin) spin.style.animation = '';
    }
  },

  async installUpdate() {
    if (!this.available || this.installing) return;
    const plugin = this.getPlugin();
    if (!plugin) {
      window.open(this.available.url, '_blank', 'noopener');
      return;
    }

    this.installing = true;
    const btn = document.querySelector('.ota-btn');
    if (btn) btn.disabled = true;
    this.updateUI('Starting download...', 'Starting...');

    try {
      const res = await plugin.downloadAndInstall({
        url: this.available.url,
        version: this.available.version
      });

      if (res && res.needsPermission) {
        this.installing = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Install';
        }
        this.updateUI(`Update v${this.available.version}`, `Install v${this.available.version}`);
        this.toast('Allow "Install unknown apps", then return here.');

        const onReturn = async () => {
          if (document.hidden) return;
          document.removeEventListener('visibilitychange', onReturn);
          try {
            const p = await plugin.canInstallPackages();
            if (p && p.allowed && this.available) this.installUpdate();
          } catch (_) {}
        };
        document.addEventListener('visibilitychange', onReturn);
        return;
      }

      this.installing = false;
      this.updateUI(`Install v${this.available.version}`, `Install v${this.available.version}`);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Install';
      }
    } catch (err) {
      console.error('APK update failed:', err);
      this.installing = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Retry';
      }
      this.updateUI('Update failed', 'Retry Install');
      this.toast('Download failed. Check connection and retry.');
    }
  },

  showUpdateBanner() {
    if (!this.available) return;
    const old = document.querySelector('.ota-banner');
    if (old) old.remove();

    const banner = document.createElement('div');
    banner.className = 'ota-banner glass';
    const sizeText = this.available.sizeMb ? `${this.available.sizeMb} MB · ` : '';
    banner.innerHTML = `
      <div class="ota-content">
        <span class="ota-title">Update Ready · v${this.available.version}</span>
        <span class="ota-desc">${sizeText}Downloads and updates in-app</span>
      </div>
      <button class="ota-btn" type="button">Install</button>
      <div class="ota-progress" aria-hidden="true"><i></i></div>
    `;
    banner.querySelector('.ota-btn').addEventListener('click', () => {
      this.installUpdate();
    });
    document.body.appendChild(banner);
  },

  toast(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
  }
};

window.Updater = Updater;

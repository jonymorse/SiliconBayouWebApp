// proper.js — MERGED: friend’s iPad/RemoteAPI base + your menu/gallery/email/HQ download
import {
  bootstrapCameraKit,
  createMediaStreamSource,
  remoteApiServicesFactory,
  ConcatInjectable,
  Transform2D,
} from '@snap/camera-kit';
import { CONFIG } from './config.js';

/* ---------------- Supabase ---------------- */
const SUPABASE_URL = 'https://fwcdxvnpcpyxywbjwyaa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2R4dm5wY3B5eHl3Ymp3eWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5OTg5NjMsImV4cCI6MjA3MzU3NDk2M30.XEfxRw39wp5jMs3YWFszhFZ1_ZXOilraSBN8R1e3LOI';
const BUCKET = 'gallerybucket';
let supabase;

/* ---------------- Small utils ---------------- */
const enc = new TextEncoder();
const dec = new TextDecoder();
const toBytes = (o) => enc.encode(typeof o === 'string' ? o : JSON.stringify(o));
const log = (...a) => console.log('[RemoteAPI]', ...a);

const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/* ---------------- iPad detect & constraints ---------------- */
const isiPad = /iPad/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document);

const getOrientationInfo = () => {
  const type = screen.orientation?.type || (innerWidth > innerHeight ? 'landscape' : 'portrait');
  const isLandscape = String(type).includes('landscape');
  return { type, isLandscape, isPortrait: !isLandscape, width: innerWidth, height: innerHeight };
};

const getIPadCameraConstraints = (facingMode) => {
  const o = getOrientationInfo();
  return {
    facingMode: { ideal: facingMode },
    frameRate: { ideal: 30, max: 60 },
    width: {  ideal: o.isLandscape ? 1920 : 1080, max: o.isLandscape ? 1920 : 1080 },
    height:{  ideal: o.isLandscape ? 1080 : 1920, max: o.isLandscape ? 1080 : 1920 },
  };
};

/* ---------------- Remote API state (friend’s) ---------------- */
let gameState = { names: [], collected: {}, t: Date.now() };
const CACHE_KEY = 'bayou_collected_items';
const RELOAD_REASON_KEY = 'reloadReason';

function saveStateToCache(state) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch {} }
function loadStateFromCache() { try { const s = localStorage.getItem(CACHE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
function markCameraSwitch() { sessionStorage.setItem(RELOAD_REASON_KEY, 'switchCamera'); }
function isCameraSwitchReload() {
  const r = sessionStorage.getItem(RELOAD_REASON_KEY);
  if (r === 'switchCamera') { sessionStorage.removeItem(RELOAD_REASON_KEY); return true; }
  return false;
}
function sanitizeState(obj) {
  const names = Array.isArray(obj?.names) ? obj.names.map(String) : [];
  const collectedIn = obj?.collected && typeof obj.collected === 'object' ? obj.collected : {};
  const collected = {};
  names.forEach((n) => (collected[n] = collectedIn[n] === undefined ? true : !!collectedIn[n]));
  Object.keys(collectedIn).forEach((k) => { if (collectedIn[k]) { collected[k] = true; if (!names.includes(k)) names.push(k); } });
  const t = Number.isFinite(obj?.t) ? obj.t : Date.now();
  return { names, collected, t };
}
const provideRemoteApi = () => ({
  apiSpecId: CONFIG.API_SPEC_ID,
  getRequestHandler(request) {
    if (request.endpointId === 'ping') {
      const n = Date.now();
      return (reply) => reply({ status: 'success', metadata: { n: String(n) }, body: toBytes({ pong: true, t: Date.now(), n }) });
    }
    if (request.endpointId === 'get_state') {
      return (reply) => reply({ status: 'success', metadata: { count: String(gameState.names.length) }, body: toBytes(gameState) });
    }
    if (request.endpointId === 'set_state') {
      return (reply) => {
        try {
          let payloadStr = request.parameters?.payload;
          if (payloadStr == null && request.body) payloadStr = dec.decode(request.body);
          const parsed = JSON.parse(payloadStr);
          gameState = sanitizeState(parsed);
          saveStateToCache(gameState);
          reply({ status: 'success', metadata: { count: String(gameState.names.length) }, body: toBytes({ ok: true }) });
        } catch (e) {
          reply({ status: 'server_error', metadata: {}, body: toBytes(String(e?.message || e)) });
        }
      };
    }
    return undefined;
  },
});

/* ---------------- Your local gallery store ----------------
   Each item: { id, ts, dataUrl, supaPath?, supaUrl? } */
const photoStore = {
  key: 'bag-photos',
  get() { try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch { return []; } },
  set(list) { localStorage.setItem(this.key, JSON.stringify(list)); },
  addDataUrl(dataUrl) {
    const list = this.get();
    const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    list.unshift({ id, ts: Date.now(), dataUrl });
    this.set(list);
    return id;
  },
  async addBlob(blob) {
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
    return this.addDataUrl(dataUrl);
  },
  update(id, patch) { const list = this.get(); const i = list.findIndex(p => p.id === id); if (i >= 0) { list[i] = { ...list[i], ...patch }; this.set(list); } },
  getById(id) { return this.get().find(p => p.id === id) || null; },
  clear() { this.set([]); },
};

/* ---------------- App ---------------- */
class MergedBayouApp {
  constructor() {
    // canvas host
    this.outputContainer = document.getElementById('canvas-output') || document.getElementById('app');

    // views
    this.cameraView   = document.getElementById('camera-view');
    this.backpackView = document.getElementById('backpack-view');
    this.settingsView = document.getElementById('settings-view');

    // nav
    this.tabBayou    = document.getElementById('tab-bayou');
    this.tabPhoto    = document.getElementById('tab-photo');
    this.tabBag      = document.getElementById('tab-bag');
    this.tabSettings = document.getElementById('tab-settings');

    // camera UI
    this.captureButton = document.getElementById('captureButton');
    this.photoPreview  = document.getElementById('photoPreview');
    this.previewImage  = document.getElementById('previewImage');
    this.retakeButton  = document.getElementById('retakeButton');
    this.saveButton    = document.getElementById('saveButton');

    // gallery preview UI
    this.galleryPreview    = document.getElementById('galleryPreview');
    this.galleryPreviewImg = document.getElementById('galleryPreviewImg');
    this.shareEmailsInput  = document.getElementById('shareEmails');
    this.shareByEmailBtn   = document.getElementById('shareByEmailBtn');
    this.closeGalleryBtn   = document.getElementById('closeGalleryPreview');

    // settings
    this.resetBtn = document.getElementById('btn-reset-app');

    // audio
    this.backgroundAudio = document.getElementById('backgroundAudio');

    // camera state
    this.cameraKit = null;
    this.session = null;
    this.mediaStream = null;
    this.liveCanvas = null;
    this.currentFacingMode = 'environment';
    this.lensActive = false;
    this.currentLens = null;

    // misc
    this.lastCapturedBlob = null;
    this.lastSavedId = null;
    this.currentGalleryId = null;
    this.lastTap = 0;
    this.tapTimeout = null;

    // iPad helpers
    this.isIPadDevice = isiPad;
    this.lastOrientation = getOrientationInfo();
    this.orientationHandler = null;
    this.orientationChangeTimeout = null;

    this.initializeApp();
  }

  /* ---------- Boot ---------- */
  async initializeApp() {
    // Friend’s cache behavior on reload for camera switching
    if (isCameraSwitchReload()) {
      const cached = loadStateFromCache();
      if (cached) gameState = sanitizeState(cached);
    } else {
      localStorage.removeItem(CACHE_KEY);
    }

    await this.initializeSupabase();

    // UI wires (your logic)
    this.wireMenu();
    this.wireGalleryClicks();
    this.wireGalleryPreview();
    this.setupCaptureButton();
    this.setupPreviewControls();
    this.setupBackgroundAudio();
    this.setupDoubleTapGesture(); // for non-iPad or general use

    // Friend’s iPad extras
    this.setupIPadGestures();
    this.setupIPadOrientationHandling();

    // Camera Kit with Remote API (friend base)
    await this.initializeCameraKit();

    // Start on Bayou + lens (friend’s autoStart style)
    await this.startCamera();                // uses this.currentFacingMode (environment)
    await new Promise(r => setTimeout(r, 400));
    await this.toggleLens(true);             // ensure lens on
    this.switchTab('bayou');
  }

  async initializeSupabase() {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (err) {
      console.warn('Supabase init skipped:', err);
    }
  }

  /* ---------- Camera Kit (friend base) ---------- */
  async initializeCameraKit() {
    this.cameraKit = await bootstrapCameraKit(
      { apiToken: CONFIG.API_TOKEN, logger: 'console' },
      (container) => container.provides(
        ConcatInjectable(remoteApiServicesFactory.token, () => provideRemoteApi())
      )
    );
    this.session = await this.cameraKit.createSession();
    this.session.events.addEventListener('error', (e) => console.error('Camera Kit error:', e?.detail ?? e));

    // attach live canvas
    this.liveCanvas = this.session.output.live;
    if (this.outputContainer) {
      this.outputContainer.innerHTML = '';
      this.outputContainer.appendChild(this.liveCanvas);
    }
    Object.assign(this.liveCanvas.style, {
      width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000'
    });

    // friend’s resizing, but guarded to avoid Offscreen width/height crash
    this.setupIPadCanvasResizing();
  }

  setupIPadCanvasResizing() {
    const safeResize = () => {
      try {
        const rect = this.liveCanvas.getBoundingClientRect();
        // try not to throw if OffscreenCanvas took over
        this.liveCanvas.width  = Math.round(rect.width  * Math.min(devicePixelRatio || 1, 2.5));
        this.liveCanvas.height = Math.round(rect.height * Math.min(devicePixelRatio || 1, 2.5));
      } catch {
        // silently ignore; CSS sizing still works
      }
    };
    if (this.liveCanvas?.parentElement) new ResizeObserver(safeResize).observe(this.liveCanvas.parentElement);
    addEventListener('orientationchange', () => setTimeout(safeResize, 100));
    addEventListener('load', safeResize);
    safeResize();
  }

  async startCamera() {
    try {
      const constraints = {
        video: this.isIPadDevice ? getIPadCameraConstraints(this.currentFacingMode)
                                 : { facingMode: { ideal: this.currentFacingMode }, frameRate: { ideal: 30 } },
        audio: false
      };
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      const source = createMediaStreamSource(this.mediaStream);
      await this.session.setSource(source);
      if (this.currentFacingMode === 'user') source.setTransform(Transform2D.MirrorX);
      this.session.play('live');
    } catch (err) {
      if (err.name === 'OverconstrainedError') await this.tryFallbackCamera();
      else console.error('Camera failed:', err);
    }
  }

  async tryFallbackCamera() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.currentFacingMode, frameRate: { ideal: 30 } }, audio: false
      });
      const source = createMediaStreamSource(this.mediaStream);
      await this.session.setSource(source);
      if (this.currentFacingMode === 'user') source.setTransform(Transform2D.MirrorX);
      this.session.play('live');
    } catch (e) {
      console.error('Fallback camera failed:', e);
    }
  }

  async switchCamera() {
    if (!this.session) return;
    const next = this.currentFacingMode === 'user' ? 'environment' : 'user';

    // friend’s asymmetric switch behavior
    if (this.currentFacingMode === 'user' && next === 'environment') {
      markCameraSwitch(); saveStateToCache(gameState);
      try { this.mediaStream?.getTracks().forEach(t => t.stop()); } catch {}
      location.reload(); return;
    }

    try {
      this.mediaStream?.getTracks().forEach(t => t.stop());
      this.currentFacingMode = next;
      await this.startCamera();
      if (this.lensActive && this.currentLens) await this.session.applyLens(this.currentLens);
    } catch (e) {
      console.error('Switch failed:', e);
      if (this.currentFacingMode === 'environment') this.currentFacingMode = 'user';
    }
  }

  async toggleLens(forceOn = false) {
    if (!this.session) return;
    try {
      if (!forceOn && this.lensActive && this.currentLens) {
        await this.session.clearLens();
        this.lensActive = false; this.currentLens = null;
      } else {
        // KEEP FRIEND’S ORDER USING CONFIG:
        this.currentLens = await this.cameraKit.lensRepository.loadLens(
          CONFIG.LENS_ID, CONFIG.LENS_GROUP_ID
        );
        await this.session.applyLens(this.currentLens);
        this.lensActive = true;
      }
    } catch (e) {
      console.error('Lens error:', e);
      this.lensActive = false; this.currentLens = null;
    }
  }

  /* ---------- Your Menu / Tabs ---------- */
  wireMenu() {
    this.tabBayou?.addEventListener('click', async () => {
      this.currentFacingMode = 'environment';
      await this.startCamera();
      if (this.lensActive && this.currentLens) await this.session.applyLens(this.currentLens);
      this.switchTab('bayou');
    });

    this.tabPhoto?.addEventListener('click', async () => {
      this.currentFacingMode = 'user';
      await this.startCamera();
      if (this.lensActive && this.currentLens) await this.session.applyLens(this.currentLens);
      this.switchTab('photo');
    });

    this.tabBag?.addEventListener('click', () => { this.renderBackpack(); this.switchTab('bag'); });
    this.tabSettings?.addEventListener('click', () => { this.switchTab('settings'); });
  }

  switchTab(tab) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');

    this.cameraView?.classList.add('hidden');
    this.backpackView?.classList.add('hidden');
    this.settingsView?.classList.add('hidden');

    if (tab === 'bayou' || tab === 'photo') this.cameraView?.classList.remove('hidden');
    else if (tab === 'bag') this.backpackView?.classList.remove('hidden');
    else if (tab === 'settings') this.settingsView?.classList.remove('hidden');
  }

  /* ---------- Your Gallery ---------- */
  renderBackpack() {
    const grid = document.getElementById('bag-grid');
    const empty = document.getElementById('bag-empty');
    const photos = photoStore.get();
    grid.innerHTML = '';

    if (!photos.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    photos.forEach(p => {
      const item = document.createElement('div');
      item.className = 'bag-item';
      item.dataset.id = p.id;
      item.innerHTML = `
        <div class="bag-thumb" style="background-image:url('${p.dataUrl}')"></div>
        <div>Photo • ${new Date(p.ts).toLocaleDateString()}</div>
      `;
      grid.appendChild(item);
    });
  }

  wireGalleryClicks() {
    const grid = document.getElementById('bag-grid');
    if (!grid) return;
    grid.addEventListener('click', (e) => {
      const card = (e.target instanceof Element) ? e.target.closest('.bag-item') : null;
      if (!card) return;
      const id = card.dataset.id;
      if (!id) return;
      this.openGalleryPreview(id);
    });
  }

  async openGalleryPreview(id) {
    this.currentGalleryId = id;
    const photo = photoStore.getById(id);
    if (!photo) return;
    const url = photo.supaUrl || photo.dataUrl;
    this.galleryPreviewImg.src = url;
    this.galleryPreview?.classList.remove('hidden');
  }

  wireGalleryPreview() {
    this.shareByEmailBtn?.addEventListener('click', async () => {
      if (!this.currentGalleryId) return;
      const emails = (this.shareEmailsInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      const photo = photoStore.getById(this.currentGalleryId);
      if (!photo) return;

      const url = await this.ensureUploadedAndGetUrl(photo);

      // Try native share with file first
      try {
        if (navigator.canShare && url) {
          const resp = await fetch(url);
          const blob = await resp.blob();
          const file = new File([blob], 'bayou-photo.png', { type: blob.type || 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ title: 'Your Bayou Photo', text: 'Here is your photo!', files: [file] });
            return;
          }
        }
      } catch (err) {
        console.log('Native share failed, falling back to mailto:', err);
      }

      // Fallback: mailto with link
      if (url) {
        const subject = encodeURIComponent('Your Bayou Photo');
        const body = encodeURIComponent(`Here is your photo:\n${url}`);
        const to = encodeURIComponent(emails.join(','));
        location.href = `mailto:${to}?subject=${subject}&body=${body}`;
      }
    });

    this.closeGalleryBtn?.addEventListener('click', () => {
      this.galleryPreview?.classList.add('hidden');
      if (this.galleryPreviewImg) this.galleryPreviewImg.src = '';
      if (this.shareEmailsInput) this.shareEmailsInput.value = '';
      this.currentGalleryId = null;
    });
  }

  async ensureUploadedAndGetUrl(photo) {
    if (photo.supaUrl) return photo.supaUrl;
    if (!supabase) return null;
    try {
      const filename = `snap-${photo.id}.png`;
      const blob = await dataUrlToBlob(photo.dataUrl);

      const already = await supabase.storage.from(BUCKET).list('', { search: filename });
      if (!already?.data?.length) {
        const { error } = await supabase.storage.from(BUCKET).upload(filename, blob, { contentType: 'image/png', upsert: true });
        if (error) throw error;
      }

      let url = supabase.storage.from(BUCKET).getPublicUrl(filename)?.data?.publicUrl;
      if (!url) {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filename, 60 * 60 * 24);
        if (error) throw error;
        url = data?.signedUrl;
      }
      photoStore.update(photo.id, { supaPath: filename, supaUrl: url });
      return url;
    } catch (e) {
      console.error('ensureUploadedAndGetUrl failed:', e);
      return null;
    }
  }

  /* ---------- Capture / Preview / Save (your logic) ---------- */
  setupCaptureButton() {
    const btn = this.captureButton;
    if (!btn) return;

    const onPress = (ev) => {
      ev.stopPropagation?.();
      ev.preventDefault?.();
      if (this.photoPreview?.classList.contains('show')) this.hidePhotoPreview();
      else this.capturePhoto();
    };

    if (window.PointerEvent) btn.addEventListener('pointerup', onPress);
    else {
      btn.addEventListener('touchend', onPress, { passive: false });
      btn.addEventListener('click', onPress);
    }
  }

  setupPreviewControls() {
    this.retakeButton?.addEventListener('click', () => this.hidePhotoPreview());
    this.saveButton?.addEventListener('click', () => this.saveToSupabase());
  }

  capturePhoto() {
    if (!this.session || !this.liveCanvas) return;
    try {
      const rect = this.liveCanvas.getBoundingClientRect();
      const w = Math.max(1, this.liveCanvas.width  || Math.round(rect.width));
      const h = Math.max(1, this.liveCanvas.height || Math.round(rect.height));

      const temp = document.createElement('canvas');
      temp.width = w; temp.height = h;
      const ctx = temp.getContext('2d');
      ctx.drawImage(this.liveCanvas, 0, 0, w, h);

      const toBlobSafe = (cv, cb) => {
        if (cv.toBlob) return cv.toBlob(cb, 'image/png');
        const dataUrl = cv.toDataURL('image/png');
        const b = atob(dataUrl.split(',')[1]);
        const arr = new Uint8Array(b.length);
        for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
        cb(new Blob([arr], { type: 'image/png' }));
      };

      toBlobSafe(temp, (blob) => {
        if (!blob) return;
        this.lastCapturedBlob = blob;
        const url = URL.createObjectURL(blob);
        this.previewImage.src = url;
        this.photoPreview.classList.add('show');
      });
    } catch (e) { console.error('Photo capture failed:', e); }
  }

  hidePhotoPreview() {
    this.photoPreview?.classList.remove('show');
    if (this.previewImage?.src) { URL.revokeObjectURL(this.previewImage.src); this.previewImage.src = ''; }
    this.lastCapturedBlob = null; this.lastSavedId = null;
    if (this.saveButton) { this.saveButton.textContent = '📤'; this.saveButton.disabled = false; }
  }

  async saveToSupabase() {
    if (!this.lastCapturedBlob) return;

    // 1) Save locally to gallery immediately
    const id = await photoStore.addBlob(this.lastCapturedBlob);
    this.lastSavedId = id;
    if (!this.backpackView?.classList.contains('hidden')) this.renderBackpack();

    // 2) Upload to Supabase
    if (!supabase) { this.hidePhotoPreview(); return; }
    try {
      this.saveButton.textContent = '⏳'; this.saveButton.disabled = true;

      const filename = `snap-${id}.png`;
      const { error } = await supabase.storage.from(BUCKET)
        .upload(filename, this.lastCapturedBlob, { contentType: 'image/png', upsert: true });
      if (error) throw error;

      // 3) Resolve public/signed URL and persist on item
      let url = supabase.storage.from(BUCKET).getPublicUrl(filename)?.data?.publicUrl;
      if (!url) {
        const { data, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(filename, 60 * 60 * 24);
        if (sErr) throw sErr; url = data?.signedUrl;
      }
      photoStore.update(id, { supaPath: filename, supaUrl: url });

      // 4) Download HQ file to device
      downloadBlob(this.lastCapturedBlob, filename);

      this.saveButton.textContent = '✅';
      setTimeout(() => this.hidePhotoPreview(), 900);
    } catch (e) {
      console.error('Supabase upload failed:', e);
      this.saveButton.textContent = '❌';
      setTimeout(() => { this.saveButton.textContent = '📤'; this.saveButton.disabled = false; }, 1500);
    }
  }

  /* ---------- Settings ---------- */
  wireSettings() {
    this.resetBtn?.addEventListener('click', () => {
      if (confirm('Reset the app and clear your gallery?')) this.resetApp();
    });
  }
  async resetApp() {
    photoStore.clear();
    try { this.mediaStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { await this.session?.pause?.(); } catch {}
    location.reload();
  }

  /* ---------- Gestures & audio ---------- */
  setupDoubleTapGesture() {
    const cameraContainer = document.querySelector('.camera-container');
    if (!cameraContainer) return;
    const handleTap = () => {
      const now = Date.now(), gap = now - this.lastTap;
      if (this.tapTimeout) { clearTimeout(this.tapTimeout); this.tapTimeout = null; }
      if (gap > 0 && gap < 300) { this.switchCamera(); this.lastTap = 0; }
      else { this.lastTap = now; this.tapTimeout = setTimeout(() => (this.lastTap = 0), 300); }
    };
    cameraContainer.addEventListener('touchend', (e) => {
      if (e.target instanceof Element && e.target.closest('button')) return;
      handleTap();
    }, { passive: true });
    cameraContainer.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('button')) return;
      handleTap();
    });
  }

  // iPad friend extras
  setupIPadGestures() {
    if (!this.outputContainer) return;
    let touchStartTime = 0;
    this.outputContainer.addEventListener('touchstart', (e) => {
      if (!isiPad) return;
      e.preventDefault(); touchStartTime = Date.now();
    }, { passive: false });
    this.outputContainer.addEventListener('touchend', (e) => {
      if (!isiPad) return;
      e.preventDefault();
      if (Date.now() - touchStartTime < 200) this.handleIPadDoubleTap();
    }, { passive: false });
    this.outputContainer.addEventListener('click', (e) => {
      if (!e.target.closest('button')) this.handleIPadDoubleTap();
    });
  }
  handleIPadDoubleTap() {
    const now = Date.now(), dt = now - this.lastTap;
    if (this.tapTimeout) { clearTimeout(this.tapTimeout); this.tapTimeout = null; }
    if (dt < 400 && dt > 50) { this.switchCamera(); this.lastTap = 0; }
    else { this.lastTap = now; this.tapTimeout = setTimeout(() => this.lastTap = 0, 400); }
  }

  setupIPadOrientationHandling() {
    if (!isiPad) return;
    this.orientationHandler = () => {
      if (this.orientationChangeTimeout) clearTimeout(this.orientationChangeTimeout);
      this.orientationChangeTimeout = setTimeout(async () => {
        const next = getOrientationInfo();
        if (this.lastOrientation.isLandscape !== next.isLandscape) {
          try {
            this.mediaStream?.getTracks().forEach(t => t.stop());
            await new Promise(r => setTimeout(r, 100));
            await this.startCamera();
            if (this.lensActive && this.currentLens) await this.session.applyLens(this.currentLens);
          } catch (e) { console.error('Orientation change failed:', e); }
        }
        this.lastOrientation = next;
      }, 300);
    };
    screen.orientation?.addEventListener('change', this.orientationHandler);
    addEventListener('orientationchange', this.orientationHandler);
    addEventListener('resize', this.orientationHandler);
  }

  setupBackgroundAudio() {
    if (!this.backgroundAudio) return;
    this.backgroundAudio.volume = isiPad ? 0.3 : 0.2;
    this.backgroundAudio.loop = true;
    const start = async () => {
      try { await this.backgroundAudio.play(); } catch {}
      removeEventListener('touchstart', start); removeEventListener('click', start); removeEventListener('keydown', start);
    };
    addEventListener('touchstart', start, { once: true });
    addEventListener('click', start, { once: true });
    addEventListener('keydown', start, { once: true });
    this.backgroundAudio.play().catch(() => {});
  }

  destroy() {
    if (this.orientationHandler) {
      screen.orientation?.removeEventListener('change', this.orientationHandler);
      removeEventListener('orientationchange', this.orientationHandler);
      removeEventListener('resize', this.orientationHandler);
    }
    if (this.orientationChangeTimeout) clearTimeout(this.orientationChangeTimeout);
    if (this.tapTimeout) clearTimeout(this.tapTimeout);
    try { this.mediaStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { this.session?.destroy?.(); } catch {}
    if (this.backgroundAudio) { this.backgroundAudio.pause(); this.backgroundAudio.currentTime = 0; }
  }
}

/* ---------- Startup / teardown ---------- */
document.addEventListener('DOMContentLoaded', () => { window.bayouApp = new MergedBayouApp(); });
addEventListener('beforeunload', () => window.bayouApp?.destroy?.());

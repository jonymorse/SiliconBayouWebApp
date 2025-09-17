import { bootstrapCameraKit, createMediaStreamSource, Transform2D } from '@snap/camera-kit';

/* ---------------- Supabase (optional upload) ---------------- */
const SUPABASE_URL = 'https://fwcdxvnpcpyxywbjwyaa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2R4dm5wY3B5eHl3Ymp3eWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5OTg5NjMsImV4cCI6MjA3MzU3NDk2M30.XEfxRw39wp5jMs3YWFszhFZ1_ZXOilraSBN8R1e3LOI';
const BUCKET = 'gallerybucket';
let supabase; // created lazily

/* ---------------- Shared lens (same for Bayou & Photo) ----------------
   NOTE: loadLens takes (groupId, lensId). */
const LENS_GROUP_ID = '1d5338a5-2299-44e8-b41d-e69573824971';
const LENS_ID       = '6f32833b-0365-4e96-8861-bb2b332a82ec';
const API_TOKEN     = 'eyJhbGciOiJIUzI1NiIsImtpZCI6IkNhbnZhc1MyU0hNQUNQcm9kIiwidHlwIjoiSldUIn0.eyJhdWQiOiJjYW52YXMtY2FudmFzYXBpIiwiaXNzIjoiY2FudmFzLXMyc3Rva2VuIiwibmJmIjoxNzU2MDg0MjEwLCJzdWIiOiJmODFlYmJhMC1iZWIwLTRjZjItOWJlMC03MzVhMTJkNGQxMWR-U1RBR0lOR345ZWY5YTc2Mi0zMTIwLTRiOTQtOTUwMy04NWFmZjc0MWU5YmIifQ.UR2iAXnhuNEOmPuk7-qsu8vD09mrRio3vNtUo0BNz8M';

/* ---------------- Local photo store (for Backpack grid) ---------------- */
const photoStore = {
  key: 'bag-photos',
  get() { try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch { return []; } },
  set(list) { localStorage.setItem(this.key, JSON.stringify(list)); },
  add(dataUrl) {
    const list = this.get();
    const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    list.unshift({ id, ts: Date.now(), dataUrl });
    this.set(list);
  },
  clear() { this.set([]); }
};

/* ---------------- App class ---------------- */
class SnapLensApp {
  constructor() {
    /* camera + lens */
    this.cameraKit = null;
    this.session = null;
    this.mediaStream = null;
    this.currentFacingMode = 'user'; // start on FRONT camera as requested
    this.currentLens = null;

    /* canvases & UI */
    this.outputContainer = document.getElementById('canvas-output');
    this.liveCanvas = null;

    /* capture & preview */
    this.captureButton = document.getElementById('captureButton');
    this.photoPreview = document.getElementById('photoPreview');
    this.previewImage = document.getElementById('previewImage');
    this.retakeButton = document.getElementById('retakeButton');
    this.saveButton = document.getElementById('saveButton');
    this.lastCapturedBlob = null;

    /* nav + views */
    this.cameraView = document.getElementById('camera-view');
    this.backpackView = document.getElementById('backpack-view');
    this.settingsView = document.getElementById('settings-view');
    this.navButtons = document.querySelectorAll('.nav-btn');

    /* controls */
    this.btnSwitchCam = document.getElementById('btn-switch-cam');
    this.btnToggleAspect = document.getElementById('btn-toggle-aspect'); // label only; layout is fullscreen

    /* audio */
    this.backgroundAudio = document.getElementById('backgroundAudio');

    /* init */
    this.initialize();
  }

  async initialize() {
    await this.initSupabase();
    this.wireUI();
    await this.initCameraKit();
    await this.ensureLens();
    await this.setCamera('environment');        // Bayou starts on FRONT
    await this.session.play();
    this.switchTab('bayou');             // show camera view
  }

  async initSupabase() {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (e) {
      console.warn('Supabase not available (optional):', e);
    }
  }

  async initCameraKit() {
    this.cameraKit = await bootstrapCameraKit({ apiToken: API_TOKEN });
    this.session = await this.cameraKit.createSession(); // use session.output.live

    this.outputContainer.replaceWith(this.session.output.live);
    this.liveCanvas = this.session.output.live;
    this.liveCanvas.id = 'live-canvas';
    this.liveCanvas.style.width = '100%';
    this.liveCanvas.style.height = '100%';
    this.liveCanvas.style.objectFit = 'cover';
    this.liveCanvas.style.background = '#000';

    const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document);
    const dpr = isiOS ? 1 : Math.min(window.devicePixelRatio || 1, 2);

    const resizeLiveCanvas = () => {
      const rect = this.liveCanvas.getBoundingClientRect();
      this.liveCanvas.width = Math.round(rect.width * dpr);
      this.liveCanvas.height = Math.round(rect.height * dpr);
    };
    new ResizeObserver(resizeLiveCanvas).observe(this.liveCanvas.parentElement);
    window.addEventListener('orientationchange', resizeLiveCanvas);
    window.addEventListener('load', resizeLiveCanvas);
    resizeLiveCanvas();
  }

  async ensureLens() {
    if (this.currentLens) return;
    // Correct order: (groupId, lensId)
    this.currentLens = await this.cameraKit.lensRepository.loadLens(LENS_GROUP_ID, LENS_ID);
    await this.session.applyLens(this.currentLens);
  }

  async setCamera(facing) {
    this.currentFacingMode = facing;
    try { this.mediaStream?.getTracks().forEach(t => t.stop()); } catch {}

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: false
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    this.mediaStream = stream;
    const source = createMediaStreamSource(stream);
    await this.session.setSource(source);
    source.setTransform(facing === 'user' ? Transform2D.MirrorX : Transform2D.Identity);
  }

  /* ---------------- Navigation ---------------- */
  showOnly(el) {
    [this.cameraView, this.backpackView, this.settingsView].forEach(v => v.classList.add('hidden'));
    el.classList.remove('hidden');
  }

  setActive(tab) {
    this.navButtons.forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  }

  async switchTab(tab) {
    this.setActive(tab);
    if (tab === 'bayou') {
      this.showOnly(this.cameraView);
      await this.ensureLens();
      await this.setCamera('user');  // Bayou = FRONT (per your request)
    } else if (tab === 'photo') {
      this.showOnly(this.cameraView);
      await this.ensureLens();       // same lens
      await this.setCamera('user');  // Photo Booth = selfie as well
    } else if (tab === 'bag') {
      this.renderBackpack();
      this.showOnly(this.backpackView);
    } else {
      this.showOnly(this.settingsView);
    }
  }

  /* ---------------- Backpack render ---------------- */
  renderBackpack() {
    const photos = photoStore.get();
    const grid = document.getElementById('bag-grid');
    const empty = document.getElementById('bag-empty');
    grid.innerHTML = '';

    if (!photos.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    photos.forEach(p => {
      const item = document.createElement('div');
      item.className = 'bag-item';
      item.innerHTML = `
        <div class="bag-thumb" style="background-image:url('${p.dataUrl}')"></div>
        <div>Photo • ${new Date(p.ts).toLocaleDateString()}</div>
      `;
      grid.appendChild(item);
    });
  }

  /* ---------------- Capture / Preview / Save ---------------- */
  capturePhoto() {
    if (!this.liveCanvas) return;
    const tmp = document.createElement('canvas');
    const ctx = tmp.getContext('2d');
    tmp.width = this.liveCanvas.width;
    tmp.height = this.liveCanvas.height;
    ctx.drawImage(this.liveCanvas, 0, 0);

    tmp.toBlob((blob) => {
      if (!blob) return;
      this.lastCapturedBlob = blob;
      const url = URL.createObjectURL(blob);
      this.previewImage.src = url;
      this.photoPreview.classList.add('show');
    }, 'image/jpeg', 0.9);
  }

  hidePreview() {
    this.photoPreview.classList.remove('show');
    if (this.previewImage.src) URL.revokeObjectURL(this.previewImage.src);
    this.previewImage.src = '';
    this.lastCapturedBlob = null;
    this.saveButton.textContent = '📤';
    this.saveButton.disabled = false;
  }

  async saveToSupabase() {
    if (!this.lastCapturedBlob) return;

    // Add to local Backpack immediately
    const reader = new FileReader();
    reader.onload = () => {
      photoStore.add(String(reader.result));
      // If Backpack is visible, refresh it
      if (!this.backpackView.classList.contains('hidden')) this.renderBackpack();
    };
    reader.readAsDataURL(this.lastCapturedBlob);

    // Optional: upload to Supabase (kept from your friend’s code)
    if (!supabase) return this.hidePreview();
    try {
      this.saveButton.textContent = '⏳'; this.saveButton.disabled = true;
      const filename = `snap-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from(BUCKET).upload(filename, this.lastCapturedBlob, { contentType: 'image/jpeg' });
      if (error) throw error;
      this.saveButton.textContent = '✅';
      setTimeout(() => this.hidePreview(), 600);
    } catch (e) {
      console.error('Supabase upload failed:', e);
      this.saveButton.textContent = '❌';
      setTimeout(() => { this.saveButton.textContent = '📤'; this.saveButton.disabled = false; }, 1200);
    }
  }

  /* ---------------- Reset ---------------- */
  async resetApp() {
    photoStore.clear();
    try { this.mediaStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { await this.session?.pause?.(); } catch {}
    window.location.reload();
  }

  /* ---------------- UI wiring ---------------- */
  wireUI() {
    // Bottom nav
    document.getElementById('tab-bayou')?.addEventListener('click', () => this.switchTab('bayou'));
    document.getElementById('tab-photo')?.addEventListener('click', () => this.switchTab('photo'));
    document.getElementById('tab-bag')?.addEventListener('click', () => this.switchTab('bag'));
    document.getElementById('tab-settings')?.addEventListener('click', () => this.switchTab('settings'));

    // Overlay controls
    this.btnSwitchCam?.addEventListener('click', async () => {
      const next = this.currentFacingMode === 'user' ? 'environment' : 'user';
      await this.setCamera(next);
    });
    this.btnToggleAspect?.addEventListener('click', () => {
      // label only (layout is fullscreen)
      this.btnToggleAspect.textContent = this.btnToggleAspect.textContent === '3:4' ? '16:9' : '3:4';
    });

    // Capture + preview
    this.captureButton?.addEventListener('click', () => {
      if (this.photoPreview.classList.contains('show')) this.hidePreview();
      else this.capturePhoto();
    });
    this.retakeButton?.addEventListener('click', () => this.hidePreview());
    this.saveButton?.addEventListener('click', () => this.saveToSupabase());

    // Settings → Reset
    document.getElementById('btn-reset-app')?.addEventListener('click', () => {
      if (confirm('Reset the app and clear your gallery?')) this.resetApp();
    });

    // Double-tap anywhere on camera to switch cameras
    const cam = document.querySelector('.camera-container');
    let lastTap = 0, timeout;
    const handleTap = async () => {
      const now = Date.now();
      if (timeout) { clearTimeout(timeout); timeout = null; }
      if (now - lastTap < 300) {
        const next = this.currentFacingMode === 'user' ? 'environment' : 'user';
        await this.setCamera(next);
        lastTap = 0;
      } else {
        lastTap = now;
        timeout = setTimeout(() => lastTap = 0, 300);
      }
    };
    cam.addEventListener('touchend', (e) => { e.preventDefault(); handleTap(); });
    cam.addEventListener('click', (e) => { if (!e.target.closest('button')) handleTap(); });
  }

  destroy() {
    try { this.mediaStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { this.session?.destroy?.(); } catch {}
  }
}

/* boot */
document.addEventListener('DOMContentLoaded', () => {
  window.snapApp = new SnapLensApp();
});
window.addEventListener('beforeunload', () => window.snapApp?.destroy?.());

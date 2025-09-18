import { bootstrapCameraKit, createMediaStreamSource, Transform2D } from '@snap/camera-kit';

/* ---------------- Supabase (optional upload) ---------------- */
const SUPABASE_URL = 'https://fwcdxvnpcpyxywbjwyaa.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2R4dm5wY3B5eHl3Ymp3eWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5OTg5NjMsImV4cCI6MjA3MzU3NDk2M30.XEfxRw39wp5jMs3YWFszhFZ1_ZXOilraSBN8R1e3LOI';
const BUCKET = 'gallerybucket';
let supabase;

/* ---------------- Lens config (same lens for both tabs) ---------------- */
const LENS_GROUP_ID = '1d5338a5-2299-44e8-b41d-e69573824971';
const LENS_ID       = '6f32833b-0365-4e96-8861-bb2b332a82ec';
const API_TOKEN     =
  'eyJhbGciOiJIUzI1NiIsImtpZCI6IkNhbnZhc1MyU0hNQUNQcm9kIiwidHlwIjoiSldUIn0.eyJhdWQiOiJjYW52YXMtY2FudmFzYXBpIiwiaXNzIjoiY2FudmFzLXMyc3Rva2VuIiwibmJmIjoxNzU2MDg0MjEwLCJzdWIiOiJmODFlYmJhMC1iZWIwLTRjZjItOWJlMC03MzVhMTJkNGQxMWR-U1RBR0lOR345ZWY5YTc2Mi0zMTIwLTRiOTQtOTUwMy04NWFmZjc0MWU5YmIifQ.UR2iAXnhuNEOmPuk7-qsu8vD09mrRio3vNtUo0BNz8M';

/* ---------------- Small utils ---------------- */
const dataUrlToBlob = async (dataUrl) => {
  const res = await fetch(dataUrl);
  return await res.blob();
};
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/* ---------------- Local gallery store (Backpack) ----------------
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
    const dataUrl = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(blob);
    });
    return this.addDataUrl(dataUrl); // returns id
  },

  update(id, patch) {
    const list = this.get();
    const idx = list.findIndex(p => p.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      this.set(list);
    }
  },

  getById(id) { return this.get().find(p => p.id === id) || null; },

  clear() { this.set([]); },
};

class SnapLensProper {
  constructor() {
    /* Core canvas host to be replaced by Camera Kit live canvas */
    this.outputContainer = document.getElementById('canvas-output');

    /* Views */
    this.cameraView   = document.getElementById('camera-view');
    this.backpackView = document.getElementById('backpack-view');
    this.settingsView = document.getElementById('settings-view');

    /* Bottom nav */
    this.tabBayou    = document.getElementById('tab-bayou');
    this.tabPhoto    = document.getElementById('tab-photo');
    this.tabBag      = document.getElementById('tab-bag');
    this.tabSettings = document.getElementById('tab-settings');

    /* Capture & preview UI (camera) */
    this.captureButton = document.getElementById('captureButton');
    this.photoPreview  = document.getElementById('photoPreview');
    this.previewImage  = document.getElementById('previewImage');
    this.retakeButton  = document.getElementById('retakeButton');
    this.saveButton    = document.getElementById('saveButton');

    /* Gallery preview overlay */
    this.galleryPreview    = document.getElementById('galleryPreview');
    this.galleryPreviewImg = document.getElementById('galleryPreviewImg');
    this.shareEmailsInput  = document.getElementById('shareEmails');
    this.shareByEmailBtn   = document.getElementById('shareByEmailBtn');
    this.closeGalleryBtn   = document.getElementById('closeGalleryPreview');

    /* Settings */
    this.resetBtn = document.getElementById('btn-reset-app');

    /* Audio */
    this.backgroundAudio = document.getElementById('backgroundAudio');

    /* Camera state */
    this.cameraKit = null;
    this.session = null;
    this.mediaStream = null;
    this.currentFacingMode = 'environment'; // Bayou = back camera by default
    this.currentLens = null;
    this.lensActive = false;

    /* Misc */
    this.lastCapturedBlob = null;
    this.lastSavedId = null; // id in store for last saved photo
    this.lastTap = 0;
    this.tapTimeout = null;

    /* Gallery state */
    this.currentGalleryId = null;

    this.initializeApp();
  }

  /* ---------------- Boot ---------------- */
  async initializeApp() {
    await this.initializeSupabase();
    this.wireMenu();
    this.wireGalleryClicks();
    this.setupCaptureButton();
    this.setupPreviewControls();
    this.setupBackgroundAudio();
    this.setupDoubleTapGesture();
    this.wireSettings();
    this.wireGalleryPreview();

    await this.initializeCameraKit();

    // Start Bayou: back cam + lens
    await this.startCamera('environment');
    await this.applyLensSafe();
    this.switchTab('bayou'); // show camera view
  }

  async initializeSupabase() {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      console.log('🟢 Supabase initialized');
    } catch (e) {
      console.warn('Supabase init skipped:', e);
    }
  }

  /* ---------------- Camera Kit ---------------- */
  async initializeCameraKit() {
    this.cameraKit = await bootstrapCameraKit({ apiToken: API_TOKEN });
    this.session = await this.cameraKit.createSession();

    this.session.events.addEventListener('error', (ev) => {
      console.error('Camera Kit error:', ev?.detail ?? ev);
    });

    // Attach the live canvas — STYLE ONLY via CSS (no width/height writes!)
    this.outputContainer.replaceWith(this.session.output.live);
    this.liveCanvas = this.session.output.live;
    this.liveCanvas.id = 'live-canvas';
    Object.assign(this.liveCanvas.style, {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      background: '#000',
      display: 'block',
    });
  }

  async applyLensSafe() {
    try {
      // Use your exact values:
      this.currentLens = await this.cameraKit.lensRepository.loadLens(LENS_ID, LENS_GROUP_ID);
      await this.session.applyLens(this.currentLens);
      this.lensActive = true;
    } catch (e) {
      console.error('Lens load/apply failed (camera will still run):', e);
      this.lensActive = false;
      this.currentLens = null;
    }
  }

  async startCamera(facing) {
    if (facing) this.currentFacingMode = facing;

    // Stop previous stream
    try { this.mediaStream?.getTracks().forEach(t => t.stop()); } catch {}

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          facingMode: { exact: this.currentFacingMode },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
    } catch {
      // Fallback without exact constraint
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.currentFacingMode },
        audio: false,
      });
    }

    const source = createMediaStreamSource(this.mediaStream);
    await this.session.setSource(source);
    source.setTransform(this.currentFacingMode === 'user' ? Transform2D.MirrorX : Transform2D.Identity);
    this.session.play('live');
  }

  /* ---------------- Tabs & Views ---------------- */
  wireMenu() {
    this.tabBayou?.addEventListener('click', async () => {
      await this.startCamera('environment'); // back cam
      if (this.lensActive && this.currentLens) await this.session.applyLens(this.currentLens);
      this.switchTab('bayou');
    });

    this.tabPhoto?.addEventListener('click', async () => {
      await this.startCamera('user'); // selfie
      if (this.lensActive && this.currentLens) await this.session.applyLens(this.currentLens);
      this.switchTab('photo');
    });

    this.tabBag?.addEventListener('click', () => {
      this.renderBackpack();
      this.switchTab('bag');
    });

    this.tabSettings?.addEventListener('click', () => {
      this.switchTab('settings');
    });
  }

  switchTab(tab) {
    // active state
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');

    // show one view
    this.cameraView?.classList.add('hidden');
    this.backpackView?.classList.add('hidden');
    this.settingsView?.classList.add('hidden');

    if (tab === 'bayou' || tab === 'photo') {
      this.cameraView?.classList.remove('hidden');
    } else if (tab === 'bag') {
      this.backpackView?.classList.remove('hidden');
    } else if (tab === 'settings') {
      this.settingsView?.classList.remove('hidden');
    }
  }

  /* ---------------- Backpack (Gallery) ---------------- */
  renderBackpack() {
    const grid = document.getElementById('bag-grid');
    const empty = document.getElementById('bag-empty');

    const photos = photoStore.get();
    grid.innerHTML = '';

    if (!photos.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    photos.forEach(p => {
      const item = document.createElement('div');
      item.className = 'bag-item';
      item.dataset.id = p.id; // <-- store id for click
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

    // Show highest quality we have; prefer Supabase URL if known
    const imgUrl = photo.supaUrl || photo.dataUrl;
    this.galleryPreviewImg.src = imgUrl;
    this.galleryPreview.classList.remove('hidden');
  }

  wireGalleryPreview() {
    // Share
    this.shareByEmailBtn?.addEventListener('click', async () => {
      if (!this.currentGalleryId) return;
      const emailsRaw = (this.shareEmailsInput?.value || '').trim();
      const recipients = emailsRaw.split(',').map(s => s.trim()).filter(Boolean);

      const photo = photoStore.getById(this.currentGalleryId);
      if (!photo) return;

      // Ensure uploaded for a proper link
      const url = await this.ensureUploadedAndGetUrl(photo);

      // Try native share with file first (best UX on phones)
      try {
        if (navigator.canShare && url) {
          const resp = await fetch(url);
          const blob = await resp.blob();
          const file = new File([blob], 'bayou-photo.png', { type: blob.type || 'image/png' });

          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: 'Your Bayou Photo',
              text: 'Here is your photo!',
              files: [file],
            });
            return;
          }
        }
      } catch (err) {
        console.log('Native share failed, falling back to mailto:', err);
      }

      // Fallback: mailto with link in body (supports multiple recipients)
      if (url && recipients.length) {
        const subject = encodeURIComponent('Your Bayou Photo');
        const body = encodeURIComponent(`Here is your photo:\n${url}`);
        const to = encodeURIComponent(recipients.join(','));
        window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
      } else if (url) {
        // If no emails supplied, at least open mail compose with link
        const subject = encodeURIComponent('Your Bayou Photo');
        const body = encodeURIComponent(`Here is your photo:\n${url}`);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
      }
    });

    // Close
    this.closeGalleryBtn?.addEventListener('click', () => {
      this.galleryPreview.classList.add('hidden');
      this.galleryPreviewImg.src = '';
      this.shareEmailsInput.value = '';
      this.currentGalleryId = null;
    });
  }

  /* Ensure the selected photo has a Supabase URL; upload if missing. */
  async ensureUploadedAndGetUrl(photo) {
    if (photo.supaUrl) return photo.supaUrl;
    if (!supabase) return null;

    try {
      const filename = `snap-${photo.id}.png`;
      const blob = await dataUrlToBlob(photo.dataUrl);

      const already = await supabase.storage.from(BUCKET).list('', { search: filename });
      if (!already?.data?.length) {
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(filename, blob, { contentType: 'image/png', upsert: true });
        if (upErr) throw upErr;
      }

      // try public url, else signed
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

  /* ---------------- Capture / Preview / Save ---------------- */
  setupCaptureButton() {
    const btn = this.captureButton;
    if (!btn) return;

    const onPress = (ev) => {
      ev.stopPropagation?.();
      ev.preventDefault?.();

      if (this.photoPreview?.classList.contains('show')) {
        this.hidePhotoPreview();
      } else {
        this.capturePhoto();
      }
    };

    if (window.PointerEvent) {
      btn.addEventListener('pointerup', onPress);
    } else {
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
      // Read current bitmap size; don't write to liveCanvas (OffscreenCanvas managed).
      const rect = this.liveCanvas.getBoundingClientRect();
      const w = Math.max(1, this.liveCanvas.width || Math.round(rect.width));
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
    } catch (e) {
      console.error('Photo capture failed:', e);
    }
  }

  hidePhotoPreview() {
    this.photoPreview?.classList.remove('show');
    if (this.previewImage?.src) {
      URL.revokeObjectURL(this.previewImage.src);
      this.previewImage.src = '';
    }
    this.lastCapturedBlob = null;
    this.lastSavedId = null;
    if (this.saveButton) { this.saveButton.textContent = '📤'; this.saveButton.disabled = false; }
  }

  async saveToSupabase() {
    if (!this.lastCapturedBlob) return;

    // 1) Add to local Backpack immediately (returns id we can use)
    const id = await photoStore.addBlob(this.lastCapturedBlob);
    this.lastSavedId = id;
    if (!this.backpackView?.classList.contains('hidden')) this.renderBackpack();

    // 2) Upload to Supabase (optional but desired)
    if (!supabase) { this.hidePhotoPreview(); return; }

    try {
      this.saveButton.textContent = '⏳';
      this.saveButton.disabled = true;

      const filename = `snap-${id}.png`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(filename, this.lastCapturedBlob, { contentType: 'image/png', upsert: true });
      if (error) throw error;

      // 3) Resolve URL (public or signed)
      let url = supabase.storage.from(BUCKET).getPublicUrl(filename)?.data?.publicUrl;
      if (!url) {
        const { data, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(filename, 60 * 60 * 24);
        if (sErr) throw sErr;
        url = data?.signedUrl;
      }

      // Store Supabase info in our gallery item
      photoStore.update(id, { supaPath: filename, supaUrl: url });

      // 4) Download HQ file to device (as requested)
      downloadBlob(this.lastCapturedBlob, filename);

      this.saveButton.textContent = '✅';
      setTimeout(() => this.hidePhotoPreview(), 900);
    } catch (e) {
      console.error('Supabase upload failed:', e);
      this.saveButton.textContent = '❌';
      setTimeout(() => {
        this.saveButton.textContent = '📤';
        this.saveButton.disabled = false;
      }, 1500);
    }
  }

  /* ---------------- Settings ---------------- */
  wireSettings() {
    this.resetBtn?.addEventListener('click', () => {
      if (confirm('Reset the app and clear your gallery?')) this.resetApp();
    });
  }

  async resetApp() {
    photoStore.clear();
    try { this.mediaStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { await this.session?.pause?.(); } catch {}
    window.location.reload();
  }

  /* ---------------- Gestures & Audio ---------------- */
  setupDoubleTapGesture() {
    const cameraContainer = document.querySelector('.camera-container');
    if (!cameraContainer) return;

    const handleTap = () => {
      const now = Date.now();
      const gap = now - this.lastTap;
      if (this.tapTimeout) { clearTimeout(this.tapTimeout); this.tapTimeout = null; }
      if (gap > 0 && gap < 300) {
        const next = this.currentFacingMode === 'user' ? 'environment' : 'user';
        this.startCamera(next).then(() => {
          if (this.lensActive && this.currentLens) this.session.applyLens(this.currentLens);
        });
        this.lastTap = 0;
      } else {
        this.lastTap = now;
        this.tapTimeout = setTimeout(() => (this.lastTap = 0), 300);
      }
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

  setupBackgroundAudio() {
    if (!this.backgroundAudio) return;
    this.backgroundAudio.volume = 0.2;
    this.backgroundAudio.loop = true;

    const startAudio = async () => {
      try {
        await this.backgroundAudio.play();
        document.removeEventListener('touchstart', startAudio);
        document.removeEventListener('click', startAudio);
        document.removeEventListener('keydown', startAudio);
      } catch {}
    };
    document.addEventListener('touchstart', startAudio, { once: true });
    document.addEventListener('click', startAudio, { once: true });
    document.addEventListener('keydown', startAudio, { once: true });

    this.backgroundAudio.play().catch(() => {});
  }

  /* ---------------- Cleanup ---------------- */
  destroy() {
    try { this.mediaStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { this.session?.destroy?.(); } catch {}
    if (this.backgroundAudio) { this.backgroundAudio.pause(); this.backgroundAudio.currentTime = 0; }
  }
}

document.addEventListener('DOMContentLoaded', () => { window.snapApp = new SnapLensProper(); });
window.addEventListener('beforeunload', () => window.snapApp?.destroy?.());

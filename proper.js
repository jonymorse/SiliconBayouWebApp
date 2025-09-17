import { bootstrapCameraKit, createMediaStreamSource, Transform2D } from '@snap/camera-kit';

/* ---------- Supabase (optional upload) ---------- */
const SUPABASE_URL = 'https://fwcdxvnpcpyxywbjwyaa.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2R4dm5wY3B5eHl3Ymp3eWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5OTg5NjMsImV4cCI6MjA3MzU3NDk2M30.XEfxRw39wp5jMs3YWFszhFZ1_ZXOilraSBN8R1e3LOI';
const BUCKET = 'gallerybucket';
let supabase;

/* ---------- Lens config (same lens for both tabs) ---------- */
const LENS_CONFIG = {
  API_TOKEN:
    'eyJhbGciOiJIUzI1NiIsImtpZCI6IkNhbnZhc1MyU0hNQUNQcm9kIiwidHlwIjoiSldUIn0.eyJhdWQiOiJjYW52YXMtY2FudmFzYXBpIiwiaXNzIjoiY2FudmFzLXMyc3Rva2VuIiwibmJmIjoxNzU2MDg0MjEwLCJzdWIiOiJmODFlYmJhMC1iZWIwLTRjZjItOWJlMC03MzVhMTJkNGQxMWR-U1RBR0lOR345ZWY5YTc2Mi0zMTIwLTRiOTQtOTUwMy04NWFmZjc0MWU5YmIifQ.UR2iAXnhuNEOmPuk7-qsu8vD09mrRio3vNtUo0BNz8M',
  // NOTE: loadLens expects (groupId, lensId)
  LENS_ID: '6f32833b-0365-4e96-8861-bb2b332a82ec',
  LENS_GROUP_ID: '1d5338a5-2299-44e8-b41d-e69573824971',
};

class SnapLensProper {
  constructor() {
    /* DOM */
    this.outputContainer = document.getElementById('canvas-output');
    this.captureButton = document.getElementById('captureButton');
    this.photoPreview = document.getElementById('photoPreview');
    this.previewImage = document.getElementById('previewImage');
    this.retakeButton = document.getElementById('retakeButton');
    this.saveButton = document.getElementById('saveButton');
    this.backgroundAudio = document.getElementById('backgroundAudio');

    /* bottom nav (optional; will no-op if not present) */
    this.tabBayou = document.getElementById('tab-bayou');
    this.tabPhoto = document.getElementById('tab-photo');

    /* camera state */
    this.cameraKit = null;
    this.session = null;
    this.mediaStream = null;
    this.currentFacingMode = 'environment'; // Bayou = BACK camera by default
    this.currentLens = null;
    this.lensActive = false;

    /* helpers */
    this.lastCapturedBlob = null;
    this.lastTap = 0;
    this.tapTimeout = null;

    this.initializeApp();
  }

  /* ---------------- boot ---------------- */
  async initializeApp() {
    await this.initializeSupabase();
    this.setupCaptureButton();
    this.setupPreviewControls();
    this.setupDoubleTapGesture();
    this.setupBackgroundAudio();
    this.setupTabs(); // Bayou / Photo booth

    await this.initializeCameraKit();

    // Start camera first (rear)
    await this.startCamera();

    // Then load & apply lens (same lens used for both tabs)
    await this.applyLensSafe();

    // Start on Bayou tab if present
    if (this.tabBayou) this.setActiveTab('bayou');
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

  /* ---------------- camera kit ---------------- */
  async initializeCameraKit() {
    try {
      this.updateStatus('Initializing…');
      this.cameraKit = await bootstrapCameraKit({ apiToken: LENS_CONFIG.API_TOKEN });
      this.session = await this.cameraKit.createSession();

      this.session.events.addEventListener('error', (ev) => {
        console.error('Camera Kit error:', ev?.detail ?? ev);
      });

      // Attach live canvas – CSS controls size. DO NOT set .width/.height!
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

      this.updateStatus('Ready');
    } catch (e) {
      console.error('Failed to init Camera Kit:', e);
      this.updateStatus('Init error');
    }
  }

  async startCamera() {
    try {
      this.updateStatus('Starting camera…');

      // Preferred constraints
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          facingMode: { exact: this.currentFacingMode },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      const source = createMediaStreamSource(this.mediaStream);
      await this.session.setSource(source);
      if (this.currentFacingMode === 'user') source.setTransform(Transform2D.MirrorX);

      this.session.play('live');
      this.updateStatus('Camera ready!');
    } catch (error) {
      console.warn('Primary constraints failed, trying fallback:', error?.name || error);
      await this.tryFallbackCamera();
    }
  }

  async tryFallbackCamera() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.currentFacingMode },
        audio: false,
      });

      const source = createMediaStreamSource(this.mediaStream);
      await this.session.setSource(source);
      if (this.currentFacingMode === 'user') source.setTransform(Transform2D.MirrorX);

      this.session.play('live');
      this.updateStatus('Camera started!');
    } catch (fallbackError) {
      console.error('Fallback camera failed:', fallbackError);
      this.updateStatus('Unable to access camera');
    }
  }

  async applyLensSafe() {
    try {
      this.updateStatus('Loading lens…');
      // Correct order: (groupId, lensId)
      this.currentLens = await this.cameraKit.lensRepository.loadLens(
        LENS_CONFIG.LENS_GROUP_ID,
        LENS_CONFIG.LENS_ID,
      );
      await this.session.applyLens(this.currentLens);
      this.lensActive = true;
      this.updateStatus('AR active!');
    } catch (e) {
      console.error('Lens load/apply failed (camera will still run):', e);
      this.updateStatus('Lens unavailable');
      this.lensActive = false;
      this.currentLens = null;
    }
  }

  async switchCamera() {
    if (!this.session) return;
    try {
      // stop previous stream
      this.mediaStream?.getTracks().forEach((t) => t.stop());

      this.currentFacingMode =
        this.currentFacingMode === 'user' ? 'environment' : 'user';

      // Their original approach: reload when going to back camera
      if (this.currentFacingMode === 'environment') {
        console.log('Switching to back camera – reloading page to avoid issues…');
        setTimeout(() => window.location.reload(), 300);
        return;
      }

      // Otherwise, start camera and re-apply lens if active
      await this.startCamera();
      if (this.lensActive && this.currentLens) {
        await this.session.applyLens(this.currentLens);
      }
    } catch (e) {
      console.error('Switch failed:', e);
      this.currentFacingMode =
        this.currentFacingMode === 'user' ? 'environment' : 'user';
    }
  }

  /* ---------------- tabs (Bayou/Photo) ---------------- */
  setupTabs() {
    if (this.tabBayou) {
      this.tabBayou.addEventListener('click', async () => {
        this.setActiveTab('bayou');
        this.currentFacingMode = 'environment'; // BACK
        await this.startCamera();
        if (this.lensActive && this.currentLens) await this.session.applyLens(this.currentLens);
      });
    }

    if (this.tabPhoto) {
      this.tabPhoto.addEventListener('click', async () => {
        this.setActiveTab('photo');
        this.currentFacingMode = 'user'; // SELFIE
        await this.startCamera();
        if (this.lensActive && this.currentLens) await this.session.applyLens(this.currentLens);
      });
    }
  }

  setActiveTab(tab) {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  }

  /* ---------------- capture / preview / save ---------------- */
  setupCaptureButton() {
    if (!this.captureButton) return;
    this.captureButton.addEventListener('click', () => {
      if (this.photoPreview?.classList.contains('show')) {
        this.hidePhotoPreview();
      } else {
        this.capturePhoto();
      }
    });
  }

  setupPreviewControls() {
    this.retakeButton?.addEventListener('click', () => this.hidePhotoPreview());
    this.saveButton?.addEventListener('click', () => this.saveToSupabase());
  }

  capturePhoto() {
    if (!this.session || !this.liveCanvas) return;

    try {
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');

      // Use the current CSS size (don’t touch liveCanvas.width/height)
      const rect = this.liveCanvas.getBoundingClientRect();
      tempCanvas.width = Math.max(1, Math.round(rect.width));
      tempCanvas.height = Math.max(1, Math.round(rect.height));

      tempCtx.drawImage(this.liveCanvas, 0, 0, tempCanvas.width, tempCanvas.height);

      tempCanvas.toBlob((blob) => {
        if (!blob) return console.error('Failed to create photo blob');
        this.lastCapturedBlob = blob;
        const url = URL.createObjectURL(blob);
        this.previewImage.src = url;
        this.showPhotoPreview();

        // small click feedback
        this.captureButton.style.transform = 'scale(0.95)';
        setTimeout(() => (this.captureButton.style.transform = ''), 150);
      }, 'image/png');
    } catch (e) {
      console.error('Photo capture failed:', e);
    }
  }

  showPhotoPreview() {
    this.photoPreview?.classList.add('show');
    if (this.captureButton) this.captureButton.style.opacity = '0.8';
  }

  hidePhotoPreview() {
    this.photoPreview?.classList.remove('show');
    if (this.captureButton) this.captureButton.style.opacity = '1';
    if (this.saveButton) {
      this.saveButton.textContent = '📤';
      this.saveButton.disabled = false;
    }
    if (this.previewImage?.src) {
      URL.revokeObjectURL(this.previewImage.src);
      this.previewImage.src = '';
    }
    this.lastCapturedBlob = null;
  }

  async saveToSupabase() {
    if (!this.lastCapturedBlob || !supabase) {
      console.error('Cannot save: missing photo or Supabase not ready');
      return;
    }
    try {
      this.saveButton.textContent = '⏳';
      this.saveButton.disabled = true;

      const filename = `snap-capture-${Date.now()}.png`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(filename, this.lastCapturedBlob, { contentType: 'image/png' });

      if (error) throw error;

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

  /* ---------------- gestures & audio ---------------- */
  setupDoubleTapGesture() {
    const cameraContainer = document.querySelector('.camera-container');
    if (!cameraContainer) return;

    cameraContainer.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.handleDoubleTap();
    });
    cameraContainer.addEventListener('click', (e) => {
      if (!e.target.closest('button')) this.handleDoubleTap();
    });
  }

  handleDoubleTap() {
    const now = Date.now();
    const gap = now - this.lastTap;

    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
      this.tapTimeout = null;
    }

    if (gap > 0 && gap < 300) {
      this.switchCamera();
      this.lastTap = 0;
    } else {
      this.lastTap = now;
      this.tapTimeout = setTimeout(() => (this.lastTap = 0), 300);
    }
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

    // best effort (may be blocked)
    this.backgroundAudio.play().catch(() => {});
  }

  /* ---------------- utils ---------------- */
  updateStatus(msg) {
    if (this.outputContainer && this.outputContainer.tagName === 'DIV') {
      this.outputContainer.textContent = msg;
    }
    console.log(msg);
  }

  destroy() {
    try {
      this.mediaStream?.getTracks().forEach((t) => t.stop());
    } catch {}
    try {
      this.session?.destroy?.();
    } catch {}
    if (this.backgroundAudio) {
      this.backgroundAudio.pause();
      this.backgroundAudio.currentTime = 0;
    }
  }
}

/* Boot */
document.addEventListener('DOMContentLoaded', () => {
  window.snapApp = new SnapLensProper();
});
window.addEventListener('beforeunload', () => window.snapApp?.destroy?.());

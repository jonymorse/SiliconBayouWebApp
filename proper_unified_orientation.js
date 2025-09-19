// Unified proper.js - Remote API + Camera Controls + Caching System + Photo Capture + Rear Camera Orientation
import {
  bootstrapCameraKit,
  createMediaStreamSource,
  remoteApiServicesFactory,
  ConcatInjectable,
  Transform2D,
} from '@snap/camera-kit';
import { CONFIG } from './config.js';

// Supabase configuration
const SUPABASE_URL = 'https://fwcdxvnpcpyxywbjwyaa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3Y2R4dm5wY3B5eHl3Ymp3eWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5OTg5NjMsImV4cCI6MjA3MzU3NDk2M30.XEfxRw39wp5jMs3YWFszhFZ1_ZXOilraSBN8R1e3LOI';
const BUCKET = 'gallerybucket';

// Initialize Supabase (will be available after DOM loads)
let supabase;

// ---------- Utilities ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
const toBytes = (o) => enc.encode(typeof o === 'string' ? o : JSON.stringify(o));
const log = (...a) => console.log('[RemoteAPI]', ...a);

// ---------- State Management ----------
// Start with empty state - lens will populate this with real data
let gameState = {
  names: [],
  collected: {},
  t: Date.now(),
};

// Cache keys
const CACHE_KEY = 'bayou_collected_items';
const RELOAD_REASON_KEY = 'reloadReason';

// ---------- Cache Management ----------
function saveStateToCache(state) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    log('State saved to cache:', state);
  } catch (error) {
    console.error('Failed to save state to cache:', error);
  }
}

function loadStateFromCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const state = JSON.parse(cached);
      log('State loaded from cache:', state);
      return state;
    }
  } catch (error) {
    console.error('Failed to load state from cache:', error);
  }
  return null;
}

function markCameraSwitch() {
  sessionStorage.setItem(RELOAD_REASON_KEY, 'switchCamera');
  log('Marked camera switch in session storage');
}

function isCameraSwitchReload() {
  const reason = sessionStorage.getItem(RELOAD_REASON_KEY);
  if (reason === 'switchCamera') {
    sessionStorage.removeItem(RELOAD_REASON_KEY); // Clean up
    log('Detected camera switch reload');
    return true;
  }
  log('Normal page load (not camera switch)');
  return false;
}

// ---------- State Validation ----------
function sanitizeState(obj) {
  const names = Array.isArray(obj?.names) ? obj.names.map(String) : [];
  const collectedIn = obj?.collected && typeof obj.collected === 'object' ? obj.collected : {};
  const collected = {};
  
  // Mark true for any name present; also copy any true flags in collectedIn
  names.forEach((n) => (collected[n] = collectedIn[n] === undefined ? true : !!collectedIn[n]));
  Object.keys(collectedIn).forEach((k) => {
    if (collectedIn[k]) {
      collected[k] = true;
      if (!names.includes(k)) names.push(k);
    }
  });
  
  const t = Number.isFinite(obj?.t) ? obj.t : Date.now();
  return { names, collected, t };
}

// ---------- Remote API Provider ----------
let hb = 0; // ping counter

const provideRemoteApi = () => ({
  apiSpecId: CONFIG.API_SPEC_ID,
  getRequestHandler(request) {
    const bodyLen = (request?.body && (request.body.byteLength ?? request.body.length)) || 0;
    log('REQ', `endpoint=${request.endpointId}`, `params=${JSON.stringify(request.parameters || {})}`, `body=${bodyLen}B`);

    // --- /ping ---
    if (request.endpointId === 'ping') {
      const n = ++hb;
      const t0 = performance.now();
      return (reply) => {
        reply({
          status: 'success',
          metadata: { n: String(n) },
          body: toBytes({ pong: true, t: Date.now(), n }),
        });
        log('RES', `ping #${n}`, `${Math.round(performance.now() - t0)}ms`);
      };
    }
    // --- /get_state ---
    if (request.endpointId === 'get_state') {
      const t0 = performance.now();
      return (reply) => {
        reply({
          status: 'success',
          metadata: { count: String(gameState.names.length) },
          body: toBytes(gameState),
        });
        log('RES', `get_state`, `${Math.round(performance.now() - t0)}ms`, gameState);
      };
    }

    // --- /set_state ---
    if (request.endpointId === 'set_state') {
      const t0 = performance.now();
      return (reply) => {
        try {
          let payloadStr = request.parameters?.payload;
          if (payloadStr == null) {
            if (request.body) payloadStr = dec.decode(request.body);
          }
          if (typeof payloadStr !== 'string') {
            reply({
              status: 'bad_request',
              metadata: {},
              body: toBytes('missing or invalid "payload" (expected stringified JSON)'),
            });
            return;
          }

          const parsed = JSON.parse(payloadStr);
          gameState = sanitizeState(parsed);
          
          // Save updated state to cache
          saveStateToCache(gameState);

          reply({
            status: 'success',
            metadata: { count: String(gameState.names.length) },
            body: toBytes({ ok: true }),
          });
          
          log('RES', `set_state`, `${Math.round(performance.now() - t0)}ms`, 'Updated gameState:', gameState);
        } catch (e) {
          reply({
            status: 'server_error',
            metadata: {},
            body: toBytes(String(e?.message || e)),
          });
        }
      };
    }

    return undefined;
  },
});

// ---------- Rear Camera Orientation Manager ----------
class RearCameraOrientationManager {
  constructor(session, cameraKit) {
    this.session = session;
    this.cameraKit = cameraKit;
    this.currentOrientation = 'portrait';
    this.mediaStream = null;
    this.currentLens = null;
    this.worldTrackingActive = false;
    this.resizeTimeout = null;
    
    // Bind methods
    this.handleOrientationChange = this.handleOrientationChange.bind(this);
    
    this.setupOrientationHandling();
  }

  setupOrientationHandling() {
    // Detect initial orientation
    this.detectOrientation();
    
    // Set up orientation listeners
    if (screen.orientation) {
      screen.orientation.addEventListener('change', this.handleOrientationChange);
    }
    window.addEventListener('orientationchange', this.handleOrientationChange);
    
    // Delay to allow orientation to settle
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = setTimeout(this.handleOrientationChange, 200);
    });
  }

  detectOrientation() {
    let newOrientation = 'portrait';
    
    if (screen.orientation) {
      newOrientation = screen.orientation.type.includes('landscape') ? 'landscape' : 'portrait';
    } else if (typeof window.orientation !== 'undefined') {
      const angle = Math.abs(window.orientation);
      newOrientation = (angle === 90 || angle === 270) ? 'landscape' : 'portrait';
    } else {
      const ratio = window.innerWidth / window.innerHeight;
      newOrientation = ratio > 1 ? 'landscape' : 'portrait';
    }
    
    this.currentOrientation = newOrientation;
    console.log(`[RearCamera] Orientation: ${newOrientation}`);
    
    // Update body class for CSS
    document.body.classList.remove('portrait-mode', 'landscape-mode');
    document.body.classList.add(`${newOrientation}-mode`, 'rear-camera-mode');
  }

  async handleOrientationChange() {
    const previousOrientation = this.currentOrientation;
    this.detectOrientation();
    
    if (previousOrientation !== this.currentOrientation) {
      console.log(`[RearCamera] Orientation changed: ${previousOrientation} → ${this.currentOrientation}`);
      
      // For rear camera, we need a complete restart to reset world tracking
      await this.restartRearCameraForOrientation();
    }
  }

  async startRearCamera() {
    try {
      // Stop existing stream
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
      }

      // Get orientation-optimized camera constraints
      const constraints = this.getRearCameraConstraints();
      
      console.log(`[RearCamera] Starting camera for ${this.currentOrientation} mode`);
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      const source = createMediaStreamSource(this.mediaStream, {
        cameraType: 'environment', // Always rear camera
        fpsLimit: 30
      });

      await this.session.setSource(source);
      
      // CRITICAL: Do NOT apply transforms for rear camera in most cases
      // World tracking needs to understand the real device orientation
      
      this.session.play('live');
      
      console.log(`[RearCamera] Camera started successfully in ${this.currentOrientation} mode`);
      
      return source;
      
    } catch (error) {
      console.error('[RearCamera] Camera start failed:', error);
      await this.tryFallbackRearCamera();
    }
  }

  getRearCameraConstraints() {
    const baseConstraints = {
      audio: false,
      video: {
        facingMode: { exact: 'environment' }, // Force rear camera
        frameRate: { ideal: 30, max: 30 }
      }
    };

    // CRITICAL FIX: Always request standard landscape resolution
    // Let the device handle orientation automatically
    baseConstraints.video.width = { ideal: 1280 };
    baseConstraints.video.height = { ideal: 720 };

    console.log(`[RearCamera] Requesting standard landscape resolution: 1280x720 for ${this.currentOrientation} mode`);

    return baseConstraints;
  }
  async restartRearCameraForOrientation() {
    if (!this.session) return;

    console.log(`[RearCamera] Restarting for ${this.currentOrientation} orientation`);

    try {
      // 1. Clear current lens to reset world tracking
      if (this.worldTrackingActive) {
        await this.session.clearLens();
        this.worldTrackingActive = false;
        
        // Delay to ensure world tracking is fully cleared
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // 2. Restart camera with standard landscape constraints
      const source = await this.startRearCamera();

      // 3. Longer delay for orientation settle
      await new Promise(resolve => setTimeout(resolve, 800));

      // 4. Reapply lens if it was active
      if (this.currentLens) {
        console.log('[RearCamera] Reapplying lens after orientation change');
        
        await this.session.applyLens(this.currentLens);
        this.worldTrackingActive = true;
      }

      // 5. Update canvas sizing
      this.updateCanvasForOrientation();

    } catch (error) {
      console.error('[RearCamera] Restart failed:', error);
    }
  }

  async applyLens(lens) {
    try {
      this.currentLens = lens;
      await this.session.applyLens(lens);
      this.worldTrackingActive = true;
      
      console.log(`[RearCamera] Lens applied in ${this.currentOrientation} mode`);
      
    } catch (error) {
      console.error('[RearCamera] Lens application failed:', error);
      this.currentLens = null;
      this.worldTrackingActive = false;
    }
  }

  async clearLens() {
    try {
      await this.session.clearLens();
      this.currentLens = null;
      this.worldTrackingActive = false;
      
      console.log('[RearCamera] Lens cleared');
      
    } catch (error) {
      console.error('[RearCamera] Lens clear failed:', error);
    }
  }

  updateCanvasForOrientation() {
    const canvas = this.session?.output?.live;
    if (!canvas) return;

    // Force canvas to recalculate its dimensions
    setTimeout(() => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      
      console.log(`[RearCamera] Canvas updated: ${canvas.width}x${canvas.height} for ${this.currentOrientation}`);
    }, 100);
  }

  async tryFallbackRearCamera() {
    try {
      console.log('[RearCamera] Trying fallback constraints...');
      
      const fallbackConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' }
          // Remove specific resolution constraints
        }
      };

      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      
      const source = createMediaStreamSource(this.mediaStream, {
        cameraType: 'environment'
      });

      await this.session.setSource(source);
      this.session.play('live');

      console.log('[RearCamera] Fallback camera successful');

    } catch (fallbackError) {
      console.error('[RearCamera] Fallback camera failed:', fallbackError);
    }
  }

  destroy() {
    // Clean up orientation listeners
    if (screen.orientation) {
      screen.orientation.removeEventListener('change', this.handleOrientationChange);
    }
    window.removeEventListener('orientationchange', this.handleOrientationChange);
    
    clearTimeout(this.resizeTimeout);

    // Stop camera
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
    }
  }
}
// ---------- Enhanced BayouARApp with Rear Camera Orientation Support ----------
class BayouARApp {
  constructor() {
    this.outputContainer = document.getElementById('app');
    this.captureButton = document.getElementById('captureButton');
    this.photoPreview = document.getElementById('photoPreview');
    this.previewImage = document.getElementById('previewImage');
    this.retakeButton = document.getElementById('retakeButton');
    this.saveButton = document.getElementById('saveButton');
    this.lastCapturedBlob = null;
    this.cameraKit = null;
    this.session = null;
    this.rearCameraManager = null;
    this.lensActive = false;
    this.currentLens = null;
    this.currentFacingMode = 'environment'; // Default to rear camera
    this.lastTap = 0;
    this.tapTimeout = null;
    this.backgroundAudio = document.getElementById('backgroundAudio');
    this.liveCanvas = null;
    
    this.initializeApp();
  }
  
  async initializeApp() {
    // Check if this is a camera switch reload
    if (isCameraSwitchReload()) {
      // Only restore cache if this was triggered by camera switch
      const cachedState = loadStateFromCache();
      if (cachedState) {
        gameState = sanitizeState(cachedState);
        log('Restored state from cache after camera switch:', gameState);
      }
    } else {
      // Manual refresh or normal page load - clear any existing cache
      localStorage.removeItem(CACHE_KEY);
      log('Manual refresh detected - cache cleared, starting fresh');
    }
    
    // Initialize Supabase
    await this.initializeSupabase();
    
    // Setup UI event listeners
    this.setupCaptureButton();
    this.setupPreviewControls();
    this.setupDoubleTapGesture();
    this.setupBackgroundAudio();
    
    // Initialize Camera Kit
    await this.initializeCameraKit();
    await this.autoStartWithLens();
  }

  async initializeSupabase() {
    try {
      // Import Supabase
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      
      console.log('● Supabase initialized successfully');
    } catch (error) {
      console.error('■ Supabase initialization failed:', error);
    }
  }
  
  setupCaptureButton() {
    if (this.captureButton) {
      this.captureButton.addEventListener('click', () => {
        if (this.photoPreview && this.photoPreview.classList.contains('show')) {
          this.hidePhotoPreview();
        } else {
          this.capturePhoto();
        }
      });
    }
  }
  
  setupPreviewControls() {
    if (this.retakeButton) {
      this.retakeButton.addEventListener('click', () => {
        this.hidePhotoPreview();
      });
    }
    
    if (this.saveButton) {
      this.saveButton.addEventListener('click', () => {
        this.saveToSupabase();
      });
    }
  }

  async initializeCameraKit() {
    try {
      // Initialize Camera Kit with Remote API provider
      this.cameraKit = await bootstrapCameraKit(
        { apiToken: CONFIG.API_TOKEN, logger: 'console' },
        (container) =>
          container.provides(
            ConcatInjectable(remoteApiServicesFactory.token, () => provideRemoteApi())
          )
      );
      
      console.info('[RemoteAPI] provider registered for spec:', CONFIG.API_SPEC_ID);
      
      this.session = await this.cameraKit.createSession();
      window.ckSession = this.session;
      
      this.session.events.addEventListener('error', (event) => {
        console.error('Camera Kit error:', event.detail);
      });
      
      // Initialize rear camera manager after session is created
      this.rearCameraManager = new RearCameraOrientationManager(this.session, this.cameraKit);
      
      // Replace the container with live canvas
      this.liveCanvas = this.session.output.live;
      this.outputContainer.appendChild(this.liveCanvas);
      
      // Style the canvas
      this.liveCanvas.style.width = '100%';
      this.liveCanvas.style.height = '100%';
      this.liveCanvas.style.objectFit = 'cover';
      this.liveCanvas.style.display = 'block';
      this.liveCanvas.style.background = '#000';
      
      // Canvas resizing logic
      const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
        (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document);
      const dpr = isiOS ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      
      const resizeLiveCanvas = () => {
        const rect = this.liveCanvas.getBoundingClientRect();
        this.liveCanvas.width = Math.round(rect.width * dpr);
        this.liveCanvas.height = Math.round(rect.height * dpr);
        console.log(`Canvas sized: ${this.liveCanvas.width}x${this.liveCanvas.height}`);
      };
      
      new ResizeObserver(resizeLiveCanvas).observe(this.liveCanvas.parentElement);
      window.addEventListener('orientationchange', resizeLiveCanvas);
      window.addEventListener('load', resizeLiveCanvas);
      resizeLiveCanvas();
      
    } catch (error) {
      console.error('Failed to initialize Camera Kit:', error);
    }
  }
  // Use rear camera manager for all camera operations
  async autoStartWithLens() {
    try {
      // Use rear camera manager instead of direct camera start
      await this.rearCameraManager.startRearCamera();
      
      // Wait for camera to stabilize
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Load and apply lens
      const lens = await this.cameraKit.lensRepository.loadLens(
        CONFIG.LENS_ID,
        CONFIG.LENS_GROUP_ID
      );
      
      await this.rearCameraManager.applyLens(lens);
      this.currentLens = lens;
      this.lensActive = true;
      
    } catch (error) {
      console.error('[BayouAR] Auto-start failed:', error);
    }
  }

  async toggleLens() {
    if (!this.rearCameraManager) return;
    
    try {
      if (this.lensActive && this.currentLens) {
        await this.rearCameraManager.clearLens();
        this.lensActive = false;
        this.currentLens = null;
      } else {
        const lens = await this.cameraKit.lensRepository.loadLens(
          CONFIG.LENS_ID,
          CONFIG.LENS_GROUP_ID
        );
        await this.rearCameraManager.applyLens(lens);
        this.currentLens = lens;
        this.lensActive = true;
      }
    } catch (error) {
      console.error('[BayouAR] Lens toggle failed:', error);
      this.lensActive = false;
      this.currentLens = null;
    }
  }

  // Enhanced camera switching with orientation awareness
  async switchCamera() {
    if (!this.session) return;
    
    try {
      const newFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
      
      if (this.currentFacingMode === 'user' && newFacingMode === 'environment') {
        // Switching to rear camera - use reload method for state preservation
        log('Switching from front to back camera - reloading page');
        markCameraSwitch();
        saveStateToCache(gameState);
        
        if (this.rearCameraManager && this.rearCameraManager.mediaStream) {
          this.rearCameraManager.mediaStream.getTracks().forEach(track => track.stop());
        }
        
        window.location.reload();
        return;
      }
      
      if (this.currentFacingMode === 'environment' && newFacingMode === 'user') {
        // Switching to front camera - smooth transition
        log('Switching from back to front camera - smooth switch');
        
        // Clean up rear camera manager
        if (this.rearCameraManager) {
          this.rearCameraManager.destroy();
          this.rearCameraManager = null;
        }
        
        // Switch to standard front camera handling
        this.currentFacingMode = newFacingMode;
        await this.startFrontCamera();
        
        // Reapply lens if it was active
        if (this.lensActive && this.currentLens) {
          await this.session.applyLens(this.currentLens);
        }
      }
      
    } catch (error) {
      console.error('[BayouAR] Camera switch failed:', error);
    }
  }

  // Front camera method for when switching from rear
  async startFrontCamera() {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'user' },
          frameRate: { ideal: 30 }
        },
        audio: false,
      });
      
      const source = createMediaStreamSource(mediaStream, {
        cameraType: 'user'
      });
      await this.session.setSource(source);
      
      // Mirror front camera
      source.setTransform(Transform2D.MirrorX);
      
      this.session.play('live');
      
      console.log('Front camera started successfully');
      
    } catch (error) {
      console.error('Front camera start failed:', error);
    }
  }

  capturePhoto() {
    if (!this.session || !this.liveCanvas) {
      console.error('Camera session not ready for capture');
      return;
    }
    
    try {
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      
      tempCanvas.width = this.liveCanvas.width;
      tempCanvas.height = this.liveCanvas.height;
      
      tempCtx.drawImage(this.liveCanvas, 0, 0);
      
      tempCanvas.toBlob((blob) => {
        if (blob) {
          this.lastCapturedBlob = blob;
          const url = URL.createObjectURL(blob);
          
          if (this.previewImage && this.photoPreview) {
            this.previewImage.src = url;
            this.showPhotoPreview();
          } else {
            this.downloadPhoto(blob);
          }
          
          console.log('● Photo captured!');
          
          if (this.captureButton) {
            this.captureButton.style.transform = 'scale(0.95)';
            setTimeout(() => {
              this.captureButton.style.transform = '';
            }, 150);
          }
        }
      }, 'image/png');
      
    } catch (error) {
      console.error('Photo capture failed:', error);
    }
  }

  showPhotoPreview() {
    if (this.photoPreview) {
      this.photoPreview.classList.add('show');
      if (this.captureButton) {
        this.captureButton.style.opacity = '0.8';
      }
    }
  }
  
  hidePhotoPreview() {
    if (this.photoPreview) {
      this.photoPreview.classList.remove('show');
    }
    
    if (this.captureButton) {
      this.captureButton.style.opacity = '1';
    }
    
    if (this.saveButton) {
      this.saveButton.textContent = '○';
      this.saveButton.disabled = false;
    }
    
    if (this.previewImage && this.previewImage.src) {
      URL.revokeObjectURL(this.previewImage.src);
      this.previewImage.src = '';
    }
    this.lastCapturedBlob = null;
  }
  
  async saveToSupabase() {
    if (!this.lastCapturedBlob || !supabase) {
      console.error('Cannot save: Missing photo data or Supabase not initialized');
      return;
    }
    
    try {
      if (this.saveButton) {
        this.saveButton.textContent = '●●●';
        this.saveButton.disabled = true;
      }
      
      const timestamp = Date.now();
      const filename = `snap-capture-${timestamp}.png`;
      
      console.log('↑ Uploading photo to Supabase...');
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(filename, this.lastCapturedBlob, {
          contentType: 'image/png'
        });
      
      if (error) throw error;
      
      console.log('● Photo saved to Supabase:', filename);
      
      if (this.saveButton) {
        this.saveButton.textContent = '●';
        setTimeout(() => {
          this.hidePhotoPreview();
        }, 1000);
      }
      
    } catch (error) {
      console.error('■ Failed to save to Supabase:', error);
      
      if (this.saveButton) {
        this.saveButton.textContent = '■';
        setTimeout(() => {
          this.saveButton.textContent = '↑';
          this.saveButton.disabled = false;
        }, 2000);
      }
    }
  }

  downloadPhoto(blob = null) {
    const photoBlob = blob || this.lastCapturedBlob;
    if (photoBlob) {
      const url = URL.createObjectURL(photoBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `snap-capture-${Date.now()}.png`;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      URL.revokeObjectURL(url);
      
      console.log('💾 Photo downloaded locally!');
    }
  }
  
  setupDoubleTapGesture() {
    const container = this.outputContainer;
    
    container.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.handleDoubleTap();
    });
    
    container.addEventListener('click', (e) => {
      if (!e.target.closest('button')) {
        this.handleDoubleTap();
      }
    });
  }
  
  setupBackgroundAudio() {
    if (!this.backgroundAudio) {
      return;
    }
    
    this.backgroundAudio.volume = 0.2;
    this.backgroundAudio.loop = true;
    
    const startAudio = async () => {
      try {
        await this.backgroundAudio.play();
        console.log('● Background audio started');
        document.removeEventListener('touchstart', startAudio);
        document.removeEventListener('click', startAudio);
        document.removeEventListener('keydown', startAudio);
      } catch (error) {
        console.error('■ Audio play failed:', error);
      }
    };
    
    document.addEventListener('touchstart', startAudio, { once: true });
    document.addEventListener('click', startAudio, { once: true });
    document.addEventListener('keydown', startAudio, { once: true });
    
    this.backgroundAudio.play().catch(() => {
      console.log('Audio autoplay prevented - waiting for user interaction');
    });
  }

  handleDoubleTap() {
    const currentTime = Date.now();
    const tapLength = currentTime - this.lastTap;
    
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
      this.tapTimeout = null;
    }
    
    if (tapLength < 300 && tapLength > 0) {
      this.switchCamera();
      this.lastTap = 0;
    } else {
      this.lastTap = currentTime;
      this.tapTimeout = setTimeout(() => this.lastTap = 0, 300);
    }
  }
  
  destroy() {
    // Clean up rear camera manager
    if (this.rearCameraManager) {
      this.rearCameraManager.destroy();
    }
    
    if (this.session) {
      this.session.destroy().catch(console.error);
    }
    
    if (this.backgroundAudio) {
      this.backgroundAudio.pause();
      this.backgroundAudio.currentTime = 0;
    }
  }
}

// ---------- Application Startup ----------
async function start() {
  try {
    window.bayouApp = new BayouARApp();
    console.log('🎮 Bayou AR App initialized with Rear Camera Orientation Support');
  } catch (err) {
    console.error('Failed to start app:', err);
    const app = document.getElementById('app');
    if (app) {
      app.style.color = '#fff';
      app.style.display = 'grid';
      app.style.placeItems = 'center';
      app.textContent = `App error: ${err?.message || err}`;
    }
  }
}

// ---------- Event Listeners ----------
document.addEventListener('DOMContentLoaded', start);

window.addEventListener('beforeunload', () => {
  if (window.bayouApp) {
    window.bayouApp.destroy();
  }
});

console.log('🚀 Unified Bayou AR script loaded with Rear Camera Orientation Support');
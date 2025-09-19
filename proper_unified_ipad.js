// iPad-Optimized Unified proper.js - Remote API + Camera Controls + Caching System + Photo Capture
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

// ---------- iPad Detection & Utils ----------
const isiPad = /iPad/.test(navigator.userAgent) || 
  (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document);

const getOrientationInfo = () => {
  const orientation = screen.orientation?.type || 
    (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
  const isLandscape = orientation.includes('landscape');
  const isPortrait = !isLandscape;
  
  return {
    type: orientation,
    isLandscape,
    isPortrait,
    width: window.innerWidth,
    height: window.innerHeight
  };
};

// iPad-specific camera constraints
const getIPadCameraConstraints = (facingMode) => {
  const orientation = getOrientationInfo();
  
  // iPad Pro camera resolutions (adjust for orientation and performance)
  const baseConstraints = {
    facingMode: { ideal: facingMode },
    frameRate: { ideal: 30, max: 60 },
    // iPad-optimized resolution based on orientation
    width: { 
      ideal: orientation.isLandscape ? 1920 : 1080,
      max: orientation.isLandscape ? 1920 : 1080
    },
    height: { 
      ideal: orientation.isLandscape ? 1080 : 1920,
      max: orientation.isLandscape ? 1080 : 1920  
    }
  };
  
  console.log(`[iPad] Camera constraints for ${facingMode} (${orientation.type}):`, baseConstraints);
  return baseConstraints;
};

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

// ---------- iPad-Optimized Camera App Class ----------
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
    this.mediaStream = null;
    this.lensActive = false;
    this.currentLens = null;
    this.currentFacingMode = 'environment';
    this.lastTap = 0;
    this.tapTimeout = null;
    this.backgroundAudio = document.getElementById('backgroundAudio');
    this.liveCanvas = null;
    this.orientationHandler = null;
    
    // iPad-specific properties
    this.lastOrientation = getOrientationInfo();
    this.orientationChangeTimeout = null;
    this.isIPadDevice = isiPad;
    
    console.log(`[iPad] Device detected: ${this.isIPadDevice ? 'iPad' : 'Other'}`);
    console.log(`[iPad] Initial orientation:`, this.lastOrientation);
    
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
    this.setupIPadGestures();
    this.setupBackgroundAudio();
    this.setupIPadOrientationHandling();
    
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
      
      // iPad-specific touch feedback
      if (this.isIPadDevice) {
        this.captureButton.addEventListener('touchstart', (e) => {
          e.preventDefault();
          this.captureButton.style.transform = 'scale(0.95)';
        });
        
        this.captureButton.addEventListener('touchend', (e) => {
          e.preventDefault();
          this.captureButton.style.transform = '';
        });
      }
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

  // iPad-specific orientation handling
  setupIPadOrientationHandling() {
    if (!this.isIPadDevice) return;
    
    this.orientationHandler = () => {
      // Debounce orientation changes
      if (this.orientationChangeTimeout) {
        clearTimeout(this.orientationChangeTimeout);
      }
      
      this.orientationChangeTimeout = setTimeout(async () => {
        const newOrientation = getOrientationInfo();
        
        console.log(`[iPad] Orientation changed:`, {
          from: this.lastOrientation.type,
          to: newOrientation.type,
          dimensions: `${newOrientation.width}x${newOrientation.height}`
        });
        
        // Only handle significant orientation changes
        if (this.lastOrientation.isLandscape !== newOrientation.isLandscape) {
          await this.handleIPadOrientationChange(newOrientation);
        }
        
        this.lastOrientation = newOrientation;
      }, 300); // 300ms debounce
    };
    
    // Listen for orientation changes
    screen.orientation?.addEventListener('change', this.orientationHandler);
    window.addEventListener('orientationchange', this.orientationHandler);
    window.addEventListener('resize', this.orientationHandler);
  }
  
  async handleIPadOrientationChange(newOrientation) {
    if (!this.session || !this.mediaStream) return;
    
    console.log(`[iPad] Handling orientation change to ${newOrientation.type}`);
    
    try {
      // Stop current stream
      this.mediaStream.getTracks().forEach(track => track.stop());
      
      // Wait for orientation to settle
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Restart camera with new constraints
      await this.startCamera();
      
      // Reapply lens if it was active
      if (this.lensActive && this.currentLens) {
        await this.session.applyLens(this.currentLens);
      }
      
      console.log(`[iPad] Camera restarted for ${newOrientation.type} orientation`);
      
    } catch (error) {
      console.error('[iPad] Orientation change handling failed:', error);
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
      
      // Replace the container with live canvas
      this.liveCanvas = this.session.output.live;
      this.outputContainer.appendChild(this.liveCanvas);
      
      // Style the canvas
      this.liveCanvas.style.width = '100%';
      this.liveCanvas.style.height = '100%';
      this.liveCanvas.style.objectFit = 'cover';
      this.liveCanvas.style.display = 'block';
      this.liveCanvas.style.background = '#000';
      
      // iPad-optimized canvas resizing logic
      this.setupIPadCanvasResizing();
      
    } catch (error) {
      console.error('Failed to initialize Camera Kit:', error);
    }
  }
  
  setupIPadCanvasResizing() {
    // iPad-specific device pixel ratio handling
    const getIPadDPR = () => {
      if (!this.isIPadDevice) return Math.min(window.devicePixelRatio || 1, 2);
      
      // iPad Pro has very high DPR - limit it for performance
      const baseDPR = window.devicePixelRatio || 1;
      const orientation = getOrientationInfo();
      
      // Use higher quality for landscape (more screen space)
      return orientation.isLandscape ? Math.min(baseDPR, 2.5) : Math.min(baseDPR, 2);
    };
    
    const resizeLiveCanvas = () => {
      if (!this.liveCanvas) return;
      
      const rect = this.liveCanvas.getBoundingClientRect();
      const dpr = getIPadDPR();
      const orientation = getOrientationInfo();
      
      this.liveCanvas.width = Math.round(rect.width * dpr);
      this.liveCanvas.height = Math.round(rect.height * dpr);
      
      console.log(`[iPad] Canvas sized: ${this.liveCanvas.width}x${this.liveCanvas.height} (CSS: ${rect.width}x${rect.height}, DPR: ${dpr}, ${orientation.type})`);
    };
    
    // Observe canvas container for size changes
    new ResizeObserver(resizeLiveCanvas).observe(this.liveCanvas.parentElement);
    
    // Handle orientation changes
    window.addEventListener('orientationchange', () => {
      setTimeout(resizeLiveCanvas, 100); // Delay for orientation to settle
    });
    
    // Initial resize
    window.addEventListener('load', resizeLiveCanvas);
    resizeLiveCanvas();
  }
  async startCamera() {
    try {
      // Use iPad-optimized camera constraints
      const constraints = {
        video: this.isIPadDevice ? 
          getIPadCameraConstraints(this.currentFacingMode) : 
          {
            facingMode: { ideal: this.currentFacingMode },
            frameRate: { ideal: 30 }
          },
        audio: false,
      };
      
      console.log(`[iPad] Starting camera with constraints:`, constraints);
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      const source = createMediaStreamSource(this.mediaStream);
      await this.session.setSource(source);
      
      // Apply mirroring for front camera
      if (this.currentFacingMode === 'user') {
        source.setTransform(Transform2D.MirrorX);
      }
      
      this.session.play('live');
      
      // Log actual stream settings for debugging
      if (this.isIPadDevice && this.mediaStream) {
        const videoTrack = this.mediaStream.getVideoTracks()[0];
        if (videoTrack) {
          const settings = videoTrack.getSettings();
          console.log(`[iPad] Camera stream settings:`, {
            width: settings.width,
            height: settings.height,
            frameRate: settings.frameRate,
            facingMode: settings.facingMode
          });
        }
      }
      
    } catch (error) {
      console.error('Camera failed:', error);
      if (error.name === 'OverconstrainedError') {
        await this.tryFallbackCamera();
      }
    }
  }
  
  async tryFallbackCamera() {
    try {
      console.log(`[iPad] Trying fallback camera for ${this.currentFacingMode}`);
      
      // Simpler constraints for fallback
      const fallbackConstraints = {
        video: { 
          facingMode: this.currentFacingMode,
          frameRate: { ideal: 30 }
        },
        audio: false
      };
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      
      const source = createMediaStreamSource(this.mediaStream);
      await this.session.setSource(source);
      
      if (this.currentFacingMode === 'user') {
        source.setTransform(Transform2D.MirrorX);
      }
      
      this.session.play('live');
      
      console.log(`[iPad] Fallback camera successful`);
      
    } catch (fallbackError) {
      console.error('Fallback camera failed:', fallbackError);
    }
  }

  async switchCamera() {
    if (!this.session) return;
    
    try {
      const newFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
      
      console.log(`[iPad] Switching camera: ${this.currentFacingMode} → ${newFacingMode}`);
      
      // ASYMMETRIC SWITCHING LOGIC:
      // Front → Back (user → environment): RELOAD PAGE (for consistency)
      // Back → Front (environment → user): SMOOTH SWITCH (when possible)
      
      if (this.currentFacingMode === 'user' && newFacingMode === 'environment') {
        // Front → Back: Save state and reload page
        log('[iPad] Switching from front to back camera - reloading page');
        markCameraSwitch();
        saveStateToCache(gameState);
        
        // Stop current stream before reload
        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach(track => track.stop());
        }
        
        window.location.reload();
        return;
      }
      
      // Back → Front: Smooth switch (no reload)
      log('[iPad] Switching from back to front camera - smooth switch');
      
      // Stop current stream
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
      }
      
      // Switch camera mode
      this.currentFacingMode = newFacingMode;
      
      // Restart camera with new facing mode
      await this.startCamera();
      
      // Reapply lens if it was active
      if (this.lensActive && this.currentLens) {
        await this.session.applyLens(this.currentLens);
      }
      
      console.log(`[iPad] Camera switched to: ${this.currentFacingMode}`);
      
    } catch (error) {
      console.error('[iPad] Switch failed:', error);
      // Revert facing mode on failure (only for smooth switches)
      if (this.currentFacingMode === 'environment') {
        this.currentFacingMode = 'user';
      }
    }
  }

  async toggleLens() {
    if (!this.session) return;
    
    try {
      if (this.lensActive && this.currentLens) {
        await this.session.clearLens();
        this.lensActive = false;
        this.currentLens = null;
        console.log('[iPad] Lens cleared');
      } else {
        this.currentLens = await this.cameraKit.lensRepository.loadLens(
          CONFIG.LENS_ID,
          CONFIG.LENS_GROUP_ID
        );
        await this.session.applyLens(this.currentLens);
        this.lensActive = true;
        console.log('[iPad] Lens applied');
      }
    } catch (error) {
      console.error('[iPad] Lens error:', error);
      this.lensActive = false;
      this.currentLens = null;
    }
  }
  
  async autoStartWithLens() {
    try {
      console.log('[iPad] Auto-starting camera with lens...');
      await this.startCamera();
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.toggleLens();
      console.log('[iPad] Auto-start completed');
    } catch (error) {
      console.error('[iPad] Auto-start failed:', error);
    }
  }
  capturePhoto() {
    if (!this.session || !this.liveCanvas) {
      console.error('[iPad] Camera session not ready for capture');
      return;
    }
    
    try {
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      
      tempCanvas.width = this.liveCanvas.width;
      tempCanvas.height = this.liveCanvas.height;
      
      tempCtx.drawImage(this.liveCanvas, 0, 0);
      
      // Use higher quality for iPad photos
      const quality = this.isIPadDevice ? 0.95 : 0.92;
      
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
          
          console.log(`[iPad] Photo captured! Size: ${blob.size} bytes`);
          
          // iPad-specific capture feedback
          if (this.captureButton) {
            this.captureButton.style.transform = 'scale(0.9)';
            this.captureButton.style.background = 'rgba(255, 255, 255, 0.3)';
            setTimeout(() => {
              this.captureButton.style.transform = '';
              this.captureButton.style.background = '';
            }, 200);
          }
        }
      }, 'image/png', quality);
      
    } catch (error) {
      console.error('[iPad] Photo capture failed:', error);
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
      this.saveButton.textContent = '↑';
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
      console.error('[iPad] Cannot save: Missing photo data or Supabase not initialized');
      return;
    }
    
    try {
      if (this.saveButton) {
        this.saveButton.textContent = '●●●';
        this.saveButton.disabled = true;
      }
      
      const timestamp = Date.now();
      const orientation = getOrientationInfo();
      const filename = `ipad-snap-${orientation.type}-${timestamp}.png`;
      
      console.log(`[iPad] Uploading photo to Supabase: ${filename}`);
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(filename, this.lastCapturedBlob, {
          contentType: 'image/png'
        });
      
      if (error) throw error;
      
      console.log(`[iPad] Photo saved to Supabase: ${filename}`);
      
      if (this.saveButton) {
        this.saveButton.textContent = '✓';
        setTimeout(() => {
          this.hidePhotoPreview();
        }, 1000);
      }
      
    } catch (error) {
      console.error('[iPad] Failed to save to Supabase:', error);
      
      if (this.saveButton) {
        this.saveButton.textContent = '✗';
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
      const orientation = getOrientationInfo();
      link.href = url;
      link.download = `ipad-snap-${orientation.type}-${Date.now()}.png`;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      URL.revokeObjectURL(url);
      
      console.log(`[iPad] Photo downloaded locally: ${link.download}`);
    }
  }  
  // iPad-optimized gesture handling
  setupIPadGestures() {
    const container = this.outputContainer;
    
    if (!container) return;
    
    // iPad-specific touch handling with better precision
    let touchStartTime = 0;
    let touchStartPos = { x: 0, y: 0 };
    let isDoubleTapCandidate = false;
    
    // Touch start tracking
    container.addEventListener('touchstart', (e) => {
      e.preventDefault();
      
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchStartTime = Date.now();
        touchStartPos = { x: touch.clientX, y: touch.clientY };
        isDoubleTapCandidate = true;
      } else {
        isDoubleTapCandidate = false;
      }
    }, { passive: false });
    
    // Touch end for double-tap detection
    container.addEventListener('touchend', (e) => {
      e.preventDefault();
      
      if (!isDoubleTapCandidate || e.touches.length > 0) {
        return;
      }
      
      const touchEndTime = Date.now();
      const touchDuration = touchEndTime - touchStartTime;
      
      // Only consider taps (not swipes) that are quick enough
      if (touchDuration < 200) {
        this.handleIPadDoubleTap();
      }
    }, { passive: false });
    
    // Mouse events for testing on desktop/iPad with mouse
    container.addEventListener('click', (e) => {
      if (!e.target.closest('button')) {
        this.handleIPadDoubleTap();
      }
    });
    
    // Prevent zoom and other unwanted gestures
    container.addEventListener('gesturestart', (e) => e.preventDefault());
    container.addEventListener('gesturechange', (e) => e.preventDefault());
    container.addEventListener('gestureend', (e) => e.preventDefault());
  }
  
  handleIPadDoubleTap() {
    const currentTime = Date.now();
    const tapLength = currentTime - this.lastTap;
    
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
      this.tapTimeout = null;
    }
    
    // iPad-optimized double-tap timing (slightly more generous)
    if (tapLength < 400 && tapLength > 50) {
      console.log('[iPad] Double-tap detected - switching camera');
      this.switchCamera();
      this.lastTap = 0;
    } else {
      this.lastTap = currentTime;
      this.tapTimeout = setTimeout(() => this.lastTap = 0, 400);
    }
  }
  
  setupBackgroundAudio() {
    if (!this.backgroundAudio) {
      return;
    }
    
    // iPad-optimized audio settings
    this.backgroundAudio.volume = this.isIPadDevice ? 0.3 : 0.2;
    this.backgroundAudio.loop = true;
    
    const startAudio = async () => {
      try {
        await this.backgroundAudio.play();
        console.log('[iPad] Background audio started');
        document.removeEventListener('touchstart', startAudio);
        document.removeEventListener('click', startAudio);
        document.removeEventListener('keydown', startAudio);
      } catch (error) {
        console.error('[iPad] Audio play failed:', error);
      }
    };
    
    // iPad-specific audio initialization
    document.addEventListener('touchstart', startAudio, { once: true });
    document.addEventListener('click', startAudio, { once: true });
    document.addEventListener('keydown', startAudio, { once: true });
    
    // Try immediate playback (will likely fail but worth attempting)
    this.backgroundAudio.play().catch(() => {
      console.log('[iPad] Audio autoplay prevented - waiting for user interaction');
    });
  }
  
  destroy() {
    console.log('[iPad] Destroying app...');
    
    // Clean up orientation handler
    if (this.orientationHandler) {
      screen.orientation?.removeEventListener('change', this.orientationHandler);
      window.removeEventListener('orientationchange', this.orientationHandler);
      window.removeEventListener('resize', this.orientationHandler);
    }
    
    // Clean up timeouts
    if (this.orientationChangeTimeout) {
      clearTimeout(this.orientationChangeTimeout);
    }
    
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
    }
    
    // Stop media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
    }
    
    // Destroy session
    if (this.session) {
      this.session.destroy().catch(console.error);
    }
    
    // Stop audio
    if (this.backgroundAudio) {
      this.backgroundAudio.pause();
      this.backgroundAudio.currentTime = 0;
    }
    
    console.log('[iPad] App destroyed');
  }
}

// ---------- Application Startup ----------
async function start() {
  try {
    window.bayouApp = new BayouARApp();
    console.log('🎮 [iPad] Bayou AR App initialized with iPad optimizations + Remote API + Caching + Photo Capture');
  } catch (err) {
    console.error('[iPad] Failed to start app:', err);
    const app = document.getElementById('app');
    if (app) {
      app.style.color = '#fff';
      app.style.display = 'grid';
      app.style.placeItems = 'center';
      app.textContent = `[iPad] App error: ${err?.message || err}`;
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

// iPad-specific page visibility handling
document.addEventListener('visibilitychange', () => {
  if (window.bayouApp && isiPad) {
    if (document.visibilityState === 'visible') {
      console.log('[iPad] App became visible');
    } else {
      console.log('[iPad] App became hidden');
    }
  }
});

console.log('🚀 [iPad] iPad-Optimized Bayou AR script loaded (Remote API + Camera + Caching + Photo Capture + iPad Features)');
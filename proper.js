import { bootstrapCameraKit, createMediaStreamSource, Transform2D } from '@snap/camera-kit';

const LENS_CONFIG = {
    API_TOKEN: 'eyJhbGciOiJIUzI1NiIsImtpZCI6IkNhbnZhc1MyU0hNQUNQcm9kIiwidHlwIjoiSldUIn0.eyJhdWQiOiJjYW52YXMtY2FudmFzYXBpIiwiaXNzIjoiY2FudmFzLXMyc3Rva2VuIiwibmJmIjoxNzU2MDg0MjEwLCJzdWIiOiJmODFlYmJhMC1iZWIwLTRjZjItOWJlMC03MzVhMTJkNGQxMWR-U1RBR0lOR345ZWY5YTc2Mi0zMTIwLTRiOTQtOTUwMy04NWFmZjc0MWU5YmIifQ.UR2iAXnhuNEOmPuk7-qsu8vD09mrRio3vNtUo0BNz8M',
    LENS_ID: '6f32833b-0365-4e96-8861-bb2b332a82ec',
    LENS_GROUP_ID: '1d5338a5-2299-44e8-b41d-e69573824971'
};

class SnapLensProper {
    constructor() {
        this.outputContainer = document.getElementById('canvas-output');
        this.cameraKit = null;
        this.session = null;
        this.mediaStream = null;
        this.lensActive = false;
        this.currentLens = null;
        this.currentFacingMode = 'environment';
        this.lastTap = 0;
        this.tapTimeout = null;
        this.backgroundAudio = document.getElementById('backgroundAudio');
        this.doubleTapHandler = null; // Store handler for cleanup
        
        this.initializeApp();
    }
    
    async initializeApp() {
        // Remove button event listeners since buttons are hidden
        this.setupDoubleTapGesture();
        this.setupBackgroundAudio();
        await this.initializeCameraKit();
        await this.autoStartWithLens();
    }    
    async initializeCameraKit() {
        try {
            this.updateStatus('Initializing...');
            this.cameraKit = await bootstrapCameraKit({ apiToken: LENS_CONFIG.API_TOKEN });
            this.session = await this.cameraKit.createSession();
            
            this.session.events.addEventListener("error", (event) => {
                console.error('Camera Kit error:', event.detail);
                this.updateStatus(`Error: ${event.detail}`);
            });
            
            this.outputContainer.replaceWith(this.session.output.live);
            this.liveCanvas = this.session.output.live;
            this.liveCanvas.id = 'live-canvas';
            
            // Match CSS size
            this.liveCanvas.style.width = "100%";
            this.liveCanvas.style.height = "100%";
            this.liveCanvas.style.objectFit = "cover";
            this.liveCanvas.style.background = "#000";
            this.liveCanvas.style.display = "block";
            
            // Adjust backing-store size to avoid oversized UI
            const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document);
            const dpr = isiOS ? 1 : Math.min(window.devicePixelRatio || 1, 2);
          

            const resizeLiveCanvas = () => {
                const rect = this.liveCanvas.getBoundingClientRect();
                this.liveCanvas.width = Math.round(rect.width * dpr);
                this.liveCanvas.height = Math.round(rect.height * dpr);
                console.log(`Canvas sized: ${this.liveCanvas.width}x${this.liveCanvas.height} (CSS: ${rect.width}x${rect.height}, DPR: ${dpr})`);
            };
            
            // Setup observers to keep canvas backing-store synchronized
            new ResizeObserver(resizeLiveCanvas).observe(this.liveCanvas.parentElement);
            window.addEventListener("orientationchange", resizeLiveCanvas);
            window.addEventListener("load", resizeLiveCanvas);
            
            // Initial resize
            resizeLiveCanvas();
            
            this.updateStatus('Ready to start');
            
        } catch (error) {
            console.error('Failed to initialize Camera Kit:', error);
            this.updateStatus(`Init error: ${error.message}`);
        }
    }
    
    async startCamera() {
        try {
            this.updateStatus('Starting camera...');
            
            // iOS-compatible constraints (remove 'exact' which causes freezing)
            const constraints = {
                video: { 
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: this.currentFacingMode, // Remove 'exact' wrapper
                    frameRate: { ideal: 30, max: 30 }
                },
                audio: false // Explicitly define audio per documentation
            };
            
            console.log('📱 Requesting camera with constraints:', constraints);
            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            const source = createMediaStreamSource(this.mediaStream);
            await this.session.setSource(source);
            
            if (this.currentFacingMode === 'user') {
                source.setTransform(Transform2D.MirrorX);
            }
            
            this.session.play("live");
            
            // Log actual settings to verify camera
            const track = this.mediaStream.getVideoTracks()[0];
            if (track && track.getSettings) {
                const settings = track.getSettings();
                console.log('✅ Camera started with settings:', settings);
            }
            
            this.updateStatus('Camera ready!');
            
        } catch (error) {
            console.error('❌ Camera failed:', error);
            if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
                console.log('🔄 Trying fallback constraints...');
                this.tryFallbackCamera();
            } else {
                this.updateStatus('Camera unavailable');
            }
        }
    }
    async tryFallbackCamera() {
        try {
            console.log('🔄 Attempting fallback camera with minimal constraints...');
            
            // Very basic constraints for iOS compatibility
            const fallbackConstraints = {
                video: { 
                    facingMode: this.currentFacingMode // No width/height constraints
                },
                audio: false
            };
            
            console.log('📱 Fallback constraints:', fallbackConstraints);
            this.mediaStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
            
            const source = createMediaStreamSource(this.mediaStream);
            await this.session.setSource(source);
            
            if (this.currentFacingMode === 'user') {
                source.setTransform(Transform2D.MirrorX);
            }
            
            this.session.play("live");
            
            // Log actual settings
            const track = this.mediaStream.getVideoTracks()[0];
            if (track && track.getSettings) {
                const settings = track.getSettings();
                console.log('✅ Fallback camera started with settings:', settings);
            }
            
            this.updateStatus('Camera started!');
        } catch (fallbackError) {
            console.error('❌ Fallback camera also failed:', fallbackError);
            this.updateStatus('Unable to access camera');
        }
    }
    
    // Session reset approach to restore world tracking
    async switchCamera() {
        if (!this.session) return;
        
        try {
            console.log('📱 Starting camera switch with session reset...');
            this.updateStatus('Switching camera...');
            
            // Store lens state
            const wasLensActive = this.lensActive;
            const currentLensRef = this.currentLens;
            
            // Step 1: Clear lens
            if (wasLensActive) {
                console.log('🎭 Clearing lens...');
                await this.session.clearLens();
                this.lensActive = false;
            }
            
            // Step 2: Stop all tracks
            if (this.mediaStream) {
                console.log('🔴 Stopping all media tracks...');
                this.mediaStream.getTracks().forEach(track => {
                    track.stop();
                });
                this.mediaStream = null;
            }
            
            // Step 3: DESTROY AND RECREATE SESSION (key fix!)
            console.log('💥 Destroying current session...');
            try {
                if (this.session.destroy) {
                    await this.session.destroy();
                }
            } catch (destroyError) {
                console.log('Session destroy not available, continuing...');
            }
            
            // Step 4: Switch facing mode
            const oldMode = this.currentFacingMode;
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
            console.log(`🔄 Switching from ${oldMode} to ${this.currentFacingMode}`);
            
            // Step 5: Wait for cleanup
            console.log('⏳ Waiting for complete cleanup...');
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Step 6: CREATE FRESH SESSION (restore world tracking state!)
            console.log('🆕 Creating fresh Camera Kit session...');
            this.session = await this.cameraKit.createSession();
            
            // Re-attach error listeners
            this.session.events.addEventListener("error", (event) => {
                console.error('Camera Kit error:', event.detail);
                this.updateStatus(`Error: ${event.detail}`);
            });
            
            // Replace canvas output and maintain event listeners
            if (this.liveCanvas && this.liveCanvas.parentElement) {
                const parent = this.liveCanvas.parentElement;
                this.liveCanvas.replaceWith(this.session.output.live);
                this.liveCanvas = this.session.output.live;
            } else {
                this.outputContainer.replaceWith(this.session.output.live);
                this.liveCanvas = this.session.output.live;
            }
            
            this.liveCanvas.id = 'live-canvas';
            this.liveCanvas.style.width = "100%";
            this.liveCanvas.style.height = "100%";
            this.liveCanvas.style.objectFit = "cover";
            this.liveCanvas.style.background = "#000";
            this.liveCanvas.style.display = "block";
            
            // Re-setup double-tap since we replaced the canvas
            this.setupDoubleTapGesture();
            
            console.log('✅ Fresh session created with restored gestures');
            
            // Step 7: Start camera with fresh session
            await this.startCamera();
            
            // Step 8: Wait for world tracking to stabilize
            console.log('⏳ Waiting for world tracking stabilization...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Step 9: Reapply lens to fresh session
            if (wasLensActive && currentLensRef) {
                console.log('🎭 Reapplying lens to fresh session...');
                try {
                    // Reload lens on fresh session
                    this.currentLens = await this.cameraKit.lensRepository.loadLens(
                        LENS_CONFIG.LENS_ID, 
                        LENS_CONFIG.LENS_GROUP_ID
                    );
                    await this.session.applyLens(this.currentLens);
                    this.lensActive = true;
                    
                    // Extra time for world tracking with lens
                    await new Promise(resolve => setTimeout(resolve, 800));
                    
                    this.updateStatus('AR active with fresh tracking!');
                } catch (lensError) {
                    console.error('❌ Failed to reapply lens:', lensError);
                    this.updateStatus('Camera switched, lens failed');
                }
            } else {
                this.updateStatus('Camera switched with fresh tracking!');
            }
            
            console.log('✅ Camera switch with session reset completed');
            
        } catch (error) {
            console.error('❌ Camera switch with session reset failed:', error);
            this.updateStatus('Switch failed - please refresh page');
        }
    }
    async toggleLens() {
        if (!this.session) return;
        
        try {
            if (this.lensActive && this.currentLens) {
                await this.session.clearLens();
                this.lensActive = false;
                this.currentLens = null;
                this.updateStatus('Lens removed');
            } else {
                this.updateStatus('Loading lens...');
                this.currentLens = await this.cameraKit.lensRepository.loadLens(
                    LENS_CONFIG.LENS_ID, 
                    LENS_CONFIG.LENS_GROUP_ID
                );
                await this.session.applyLens(this.currentLens);
                this.lensActive = true;
                this.updateStatus('AR active!');
            }
        } catch (error) {
            console.error('Lens error:', error);
            this.updateStatus(`Lens error: ${error.message}`);
            this.lensActive = false;
            this.currentLens = null;
        }
    }
    
    async autoStartWithLens() {
        try {
            this.updateStatus('Auto-starting...');
            await this.startCamera();
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.toggleLens();
        } catch (error) {
            console.error('Auto-start failed:', error);
            this.updateStatus('Auto-start failed');
        }
    }    
    setupDoubleTapGesture() {
        // Attach to the parent container instead of the canvas that gets replaced
        const cameraContainer = document.querySelector('.camera-container');
        
        // Remove any existing listeners to prevent duplicates
        const existingHandler = this.doubleTapHandler;
        if (existingHandler) {
            cameraContainer.removeEventListener('touchend', existingHandler);
            cameraContainer.removeEventListener('click', existingHandler);
        }
        
        // Create the handler and store it for cleanup
        this.doubleTapHandler = (e) => {
            e.preventDefault();
            this.handleDoubleTap();
        };
        
        cameraContainer.addEventListener('touchend', this.doubleTapHandler);
        cameraContainer.addEventListener('click', this.doubleTapHandler);
        
        console.log('✅ Double-tap gesture setup on camera container');
    }
    
    setupBackgroundAudio() {
        if (!this.backgroundAudio) {
            console.error('Background audio element not found!');
            return;
        }
        
        // Set audio properties
        this.backgroundAudio.volume = 0.2; // Lower volume for ambient background
        this.backgroundAudio.loop = true;
        
        // Add basic event listeners
        this.backgroundAudio.addEventListener('canplay', () => console.log('Audio: Ready to play'));
        this.backgroundAudio.addEventListener('error', (e) => {
            console.error('Audio loading error:', e.target.error);
        });
        this.backgroundAudio.addEventListener('playing', () => console.log('Audio: Now playing'));
        
        // Function to start audio (requires user interaction)
        const startAudio = async () => {
            try {
                await this.backgroundAudio.play();
                console.log('✅ Background audio started successfully!');
                // Remove event listeners once audio starts
                document.removeEventListener('touchstart', startAudio);
                document.removeEventListener('click', startAudio);
                document.removeEventListener('keydown', startAudio);
            } catch (error) {
                console.error('❌ Audio play failed:', error);
            }
        };
        
        // Add event listeners for user interaction
        document.addEventListener('touchstart', startAudio, { once: true });
        document.addEventListener('click', startAudio, { once: true });
        document.addEventListener('keydown', startAudio, { once: true });
        
        // Try to play immediately (will work if autoplay is allowed)
        this.backgroundAudio.play().catch((error) => {
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
    
    updateStatus(message) {
        if (this.outputContainer && this.outputContainer.tagName === 'DIV') {
            this.outputContainer.textContent = message;
        }
        console.log(message);
    }
    
    destroy() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
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

document.addEventListener('DOMContentLoaded', () => {
    window.snapApp = new SnapLensProper();
});

window.addEventListener('beforeunload', () => {
    if (window.snapApp) {
        window.snapApp.destroy();
    }
});

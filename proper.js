import { bootstrapCameraKit, createMediaStreamSource, Transform2D } from '@snap/camera-kit';

const LENS_CONFIG = {
    API_TOKEN: 'eyJhbGciOiJIUzI1NiIsImtpZCI6IkNhbnZhc1MyU0hNQUNQcm9kIiwidHlwIjoiSldUIn0.eyJhdWQiOiJjYW52YXMtY2FudmFzYXBpIiwiaXNzIjoiY2FudmFzLXMyc3Rva2VuIiwibmJmIjoxNzU2MDg0MjEwLCJzdWIiOiJmODFlYmJhMC1iZWIwLTRjZjItOWJlMC03MzVhMTJkNGQxMWR-U1RBR0lOR345ZWY5YTc2Mi0zMTIwLTRiOTQtOTUwMy04NWFmZjc0MWU5YmIifQ.UR2iAXnhuNEOmPuk7-qsu8vD09mrRio3vNtUo0BNz8M',
    LENS_ID: '96460356-a721-446e-873a-5c5a2140ed20',
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
            
            // Original camera constraints - keeping your rendering approach
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: { ideal: 640, max: 1280 },
                    height: { ideal: 480, max: 720 },
                    facingMode: { exact: this.currentFacingMode },
                    frameRate: { ideal: 30, max: 30 }
                }
            });
            
            const source = createMediaStreamSource(this.mediaStream);
            await this.session.setSource(source);
            
            if (this.currentFacingMode === 'user') {
                source.setTransform(Transform2D.MirrorX);
            }
            
            this.session.play("live");
            this.updateStatus('Camera ready!');
            
        } catch (error) {
            console.error('Camera failed:', error);
            if (error.name === 'OverconstrainedError') {
                this.tryFallbackCamera();
            } else {
                this.updateStatus('Camera unavailable');
            }
        }
    }    
    async tryFallbackCamera() {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: this.currentFacingMode }
            });
            
            const source = createMediaStreamSource(this.mediaStream);
            await this.session.setSource(source);
            
            if (this.currentFacingMode === 'user') {
                source.setTransform(Transform2D.MirrorX);
            }
            
            this.session.play("live");
            this.updateStatus('Camera started!');
        } catch (fallbackError) {
            console.error('Fallback camera failed:', fallbackError);
            this.updateStatus('Unable to access camera');
        }
    }
    
    async switchCamera() {
        if (!this.session) return;
        
        try {
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop());
            }
            
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
            await this.startCamera();
            
            if (this.lensActive && this.currentLens) {
                await this.session.applyLens(this.currentLens);
            }
            
        } catch (error) {
            console.error('Switch failed:', error);
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
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
        const cameraContainer = document.querySelector('.camera-container');
        
        cameraContainer.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handleDoubleTap();
        });
        
        cameraContainer.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                this.handleDoubleTap();
            }
        });
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
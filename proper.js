import { bootstrapCameraKit, createMediaStreamSource, Transform2D } from '@snap/camera-kit';

// 🎭 LENS CONFIGURATION - Easy to modify!
const LENS_CONFIG = {
    // Your API token from Camera Kit Portal
    API_TOKEN: 'eyJhbGciOiJIUzI1NiIsImtpZCI6IkNhbnZhc1MyU0hNQUNQcm9kIiwidHlwIjoiSldUIn0.eyJhdWQiOiJjYW52YXMtY2FudmFzYXBpIiwiaXNzIjoiY2FudmFzLXMyc3Rva2VuIiwibmJmIjoxNzU2MDg0MjEwLCJzdWIiOiJmODFlYmJhMC1iZWIwLTRjZjItOWJlMC03MzVhMTJkNGQxMWR-U1RBR0lOR345ZWY5YTc2Mi0zMTIwLTRiOTQtOTUwMy04NWFmZjc0MWU5YmIifQ.UR2iAXnhuNEOmPuk7-qsu8vD09mrRio3vNtUo0BNz8M',
    
    // Your lens ID - Change this to use different lenses
    LENS_ID: 'bb2576c7-eb30-43a7-82a0-a1eba1455af2',
    
    // Your lens group ID from Camera Kit Portal  
    LENS_GROUP_ID: '1d5338a5-2299-44e8-b41d-e69573824971'
};

class SnapLensProper {
    constructor() {
        this.statusEl = document.getElementById('status');
        this.outputContainer = document.getElementById('canvas-output');
        this.cameraKit = null;
        this.session = null;
        this.mediaStream = null;
        this.lensActive = false;
        this.currentLens = null;
        
        this.initializeApp();
    }
    
    async initializeApp() {
        document.getElementById('startCamera').addEventListener('click', () => this.startCamera());
        document.getElementById('capturePhoto').addEventListener('click', () => this.capturePhoto());
        document.getElementById('toggleLens').addEventListener('click', () => this.toggleLens());
        
        await this.initializeCameraKit();
    }
    
    async initializeCameraKit() {
        try {
            this.updateStatus('Initializing Camera Kit...');
            console.log('🚀 Bootstrapping Camera Kit...');
            
            const apiToken = LENS_CONFIG.API_TOKEN;
            
            // Bootstrap Camera Kit (downloads WebAssembly)
            this.cameraKit = await bootstrapCameraKit({ 
                apiToken: apiToken 
            });
            console.log('✅ Camera Kit bootstrapped');
            
            // Create session (initializes rendering engine)
            this.session = await this.cameraKit.createSession();
            console.log('✅ Camera Kit session created');
            
            // Handle errors
            this.session.events.addEventListener("error", (event) => {
                console.error('❌ Camera Kit error:', event.detail);
                this.updateStatus(`❌ Camera Kit error: ${event.detail}`);
            });
            
            // CRITICAL: Replace placeholder with Camera Kit's live output canvas
            console.log('🎥 Setting up live output canvas...');
            this.outputContainer.replaceWith(this.session.output.live);
            
            // Update reference to the new canvas
            this.liveCanvas = this.session.output.live;
            this.liveCanvas.id = 'live-canvas';
            this.liveCanvas.style.cssText = `
                display: block;
                max-width: 100%;
                height: auto;
                background: #000;
                border: 2px solid #007bff;
                border-radius: 10px;
                margin: 0 auto;
            `;
            
            this.updateStatus('✅ Camera Kit ready! Click "Start Camera".');
            
        } catch (error) {
            console.error('❌ Failed to initialize Camera Kit:', error);
            this.updateStatus(`❌ Init error: ${error.message}`);
        }
    }
    
    async startCamera() {
        try {
            this.updateStatus('🎥 Starting camera...');
            console.log('🎥 Getting user media...');
            
            // Get camera stream
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: { ideal: 640, max: 1280 },
                    height: { ideal: 480, max: 720 },
                    facingMode: 'user'
                }
            });
            console.log('✅ Got media stream');
            
            // Create Camera Kit source
            const source = createMediaStreamSource(this.mediaStream);
            console.log('✅ Created media stream source');
            
            // Set source to session
            await this.session.setSource(source);
            console.log('✅ Set source to session');
            
            // Apply mirror transform (like in the example)
            source.setTransform(Transform2D.MirrorX);
            console.log('✅ Applied mirror transform');
            
            // Start rendering to live output
            this.session.play("live");
            console.log('✅ Started live playback');
            
            this.updateStatus('✅ Camera started! Video should appear above. Click "Toggle Lens" for AR.');
            
        } catch (error) {
            console.error('❌ Failed to start camera:', error);
            this.updateStatus(`❌ Camera error: ${error.message}`);
        }
    }    
    async toggleLens() {
        if (!this.session) {
            this.updateStatus('❌ Camera not started yet');
            return;
        }
        
        try {
            if (this.lensActive && this.currentLens) {
                // Remove lens - just clear it
                console.log('🔄 Removing lens...');
                await this.session.clearLens();
                this.lensActive = false;
                this.currentLens = null;
                this.updateStatus('✅ Lens removed - showing normal camera');
                
            } else {
                // Apply lens
                this.updateStatus('🎭 Loading lens...');
                console.log('🎭 Loading lens...');
                
                const lensId = LENS_CONFIG.LENS_ID;
                const lensGroupId = LENS_CONFIG.LENS_GROUP_ID;
                
                // Load lens from repository
                console.log(`📦 Loading lens ${lensId} from group ${lensGroupId}...`);
                this.currentLens = await this.cameraKit.lensRepository.loadLens(lensId, lensGroupId);
                console.log('✅ Lens loaded:', this.currentLens);
                
                // Apply lens to session
                console.log('🎨 Applying lens to session...');
                await this.session.applyLens(this.currentLens);
                
                this.lensActive = true;
                this.updateStatus('✅ Lens applied! AR effect should be visible now.');
                console.log('✅ Lens applied successfully');
            }
            
        } catch (error) {
            console.error('❌ Lens error:', error);
            this.updateStatus(`❌ Lens error: ${error.message}`);
            
            // Reset lens state on error
            this.lensActive = false;
            this.currentLens = null;
        }
    }
    
    async capturePhoto() {
        if (!this.session || !this.liveCanvas) {
            this.updateStatus('❌ Camera not started yet');
            return;
        }
        
        try {
            console.log('📸 Capturing photo...');
            
            // Capture from the live canvas (includes lens effects)
            const blob = await new Promise(resolve => {
                this.liveCanvas.toBlob(resolve, 'image/png', 1.0);
            });
            
            if (!blob) {
                throw new Error('Failed to create image blob');
            }
            
            console.log('✅ Created image blob');
            
            // Download the image
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `snap-lens-${this.lensActive ? 'with-lens-' : 'normal-'}${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.updateStatus('📸 Photo captured and downloaded!');
            
        } catch (error) {
            console.error('❌ Capture error:', error);
            this.updateStatus(`❌ Capture error: ${error.message}`);
        }
    }
    
    updateStatus(message) {
        this.statusEl.innerHTML = `<p>${message}</p>`;
        console.log('📢', message);
    }
    
    // Cleanup method
    destroy() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (this.session) {
            this.session.destroy().catch(console.error);
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Starting proper Camera Kit app...');
    window.snapApp = new SnapLensProper();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.snapApp) {
        window.snapApp.destroy();
    }
});
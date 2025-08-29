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
        this.outputContainer = document.getElementById('canvas-output');
        this.cameraKit = null;
        this.session = null;
        this.mediaStream = null;
        this.lensActive = false;
        this.currentLens = null;
        this.currentFacingMode = 'environment'; // Start with rear camera ('user' for front, 'environment' for rear)
        
        this.initializeApp();
    }
    
    async initializeApp() {
        document.getElementById('startCamera').addEventListener('click', () => this.startCamera());
        document.getElementById('capturePhoto').addEventListener('click', () => this.capturePhoto());
        document.getElementById('toggleLens').addEventListener('click', () => this.toggleLens());
        document.getElementById('switchCamera').addEventListener('click', () => this.switchCamera());
        
        await this.initializeCameraKit();
    }
    
    async initializeCameraKit() {
        try {
            this.updateStatus('Initializing...');
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
                this.updateStatus(`Error: ${event.detail}`);
            });
            
            // CRITICAL: Replace placeholder with Camera Kit's live output canvas
            console.log('🎥 Setting up live output canvas...');
            this.outputContainer.replaceWith(this.session.output.live);
            
            // Update reference to the new canvas
            this.liveCanvas = this.session.output.live;
            this.liveCanvas.id = 'live-canvas';
            this.liveCanvas.style.cssText = `
                width: 100%;
                height: 100%;
                object-fit: cover;
                background: #000;
                display: block;
            `;
            
            this.updateStatus('Tap ▶ to start');
            
        } catch (error) {
            console.error('❌ Failed to initialize Camera Kit:', error);
            this.updateStatus(`Init error: ${error.message}`);
        }
    }
    
    async startCamera() {
        try {
            this.updateStatus('🎥 Starting camera...');
            console.log('🎥 Getting user media...');
            
            // Get camera stream - iOS optimized constraints
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: { ideal: 640, max: 1280 },
                    height: { ideal: 480, max: 720 },
                    facingMode: { exact: this.currentFacingMode }, // More reliable on iOS
                    frameRate: { ideal: 30, max: 30 } // Optimize for performance
                }
            });
            console.log('✅ Got media stream');
            
            // Create Camera Kit source
            const source = createMediaStreamSource(this.mediaStream);
            console.log('✅ Created media stream source');
            
            // Set source to session
            await this.session.setSource(source);
            console.log('✅ Set source to session');
            
            // Apply mirror transform only for front camera
            if (this.currentFacingMode === 'user') {
                source.setTransform(Transform2D.MirrorX);
                console.log('✅ Applied mirror transform for front camera');
            } else {
                console.log('✅ No mirror transform for rear camera');
            }
            
            // Start rendering to live output
            this.session.play("live");
            console.log('✅ Started live playback');
            
            this.updateStatus('Camera started! Tap ✨ for AR');
            
        } catch (error) {
            console.error('❌ Failed to start camera:', error);
            
            // iOS-specific error messages
            if (error.name === 'NotAllowedError') {
                this.updateStatus('Camera permission denied');
            } else if (error.name === 'NotFoundError') {
                this.updateStatus('No camera found');
            } else if (error.name === 'OverconstrainedError') {
                this.updateStatus('Trying basic settings...');
                // Fallback for iOS
                this.tryFallbackCamera();
            } else {
                this.updateStatus(`Camera error: ${error.message}`);
            }
        }
    }
    
    // Fallback camera method for iOS compatibility
    async tryFallbackCamera() {
        try {
            console.log('🔄 Trying fallback camera settings for iOS...');
            
            // Simplified constraints for iOS compatibility
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: this.currentFacingMode // Remove 'exact' constraint
                }
            });
            
            console.log('✅ Fallback camera successful');
            
            // Continue with normal setup
            const source = createMediaStreamSource(this.mediaStream);
            await this.session.setSource(source);
            
            if (this.currentFacingMode === 'user') {
                source.setTransform(Transform2D.MirrorX);
            }
            
            this.session.play("live");
            this.updateStatus('Camera started!');
            
        } catch (fallbackError) {
            console.error('❌ Fallback camera also failed:', fallbackError);
            this.updateStatus('Unable to access camera');
        }
    }
    
    async switchCamera() {
        if (!this.session) {
            this.updateStatus('Start camera first');
            return;
        }
        
        try {
            this.updateStatus('Switching camera...');
            console.log('🔄 Switching camera...');
            
            // Stop current stream
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop());
            }
            
            // Toggle facing mode
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
            console.log(`📷 Switching to ${this.currentFacingMode} camera`);
            
            // Get new camera stream - iOS optimized
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: { ideal: 640, max: 1280 },
                    height: { ideal: 480, max: 720 },
                    facingMode: { exact: this.currentFacingMode }, // More reliable on iOS
                    frameRate: { ideal: 30, max: 30 } // Optimize for performance
                }
            });
            console.log('✅ Got new media stream');
            
            // Create new Camera Kit source
            const source = createMediaStreamSource(this.mediaStream);
            console.log('✅ Created new media stream source');
            
            // Apply mirror transform only for front camera
            if (this.currentFacingMode === 'user') {
                source.setTransform(Transform2D.MirrorX);
                console.log('✅ Applied mirror transform for front camera');
            } else {
                console.log('✅ No mirror transform for rear camera');
            }
            
            // Set new source to session
            await this.session.setSource(source);
            console.log('✅ Set new source to session');
            
            // If lens was active, reapply it
            if (this.lensActive && this.currentLens) {
                console.log('🎭 Reapplying lens after camera switch...');
                await this.session.applyLens(this.currentLens);
                console.log('✅ Lens reapplied');
            }
            
            const cameraType = this.currentFacingMode === 'user' ? 'front' : 'rear';
            this.updateStatus(`Switched to ${cameraType} camera`);
            
        } catch (error) {
            console.error('❌ Failed to switch camera:', error);
            this.updateStatus(`Switch error: ${error.message}`);
            
            // Try to restore previous camera if switch failed
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
        }
    }    
    async toggleLens() {
        if (!this.session) {
            this.updateStatus('Start camera first');
            return;
        }
        
        try {
            if (this.lensActive && this.currentLens) {
                // Remove lens - just clear it
                console.log('🔄 Removing lens...');
                await this.session.clearLens();
                this.lensActive = false;
                this.currentLens = null;
                this.updateStatus('Lens removed');
                
            } else {
                // Apply lens
                this.updateStatus('Loading lens...');
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
                this.updateStatus('AR lens active!');
                console.log('✅ Lens applied successfully');
            }
            
        } catch (error) {
            console.error('❌ Lens error:', error);
            this.updateStatus(`Lens error: ${error.message}`);
            
            // Reset lens state on error
            this.lensActive = false;
            this.currentLens = null;
        }
    }
    
    async capturePhoto() {
        if (!this.session || !this.liveCanvas) {
            this.updateStatus('Start camera first');
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
            
            this.updateStatus('Photo saved!');
            
        } catch (error) {
            console.error('❌ Capture error:', error);
            this.updateStatus(`Capture error: ${error.message}`);
        }
    }
    
    updateStatus(message) {
        // Update the canvas output text when camera isn't started yet
        if (this.outputContainer && this.outputContainer.tagName === 'DIV') {
            this.outputContainer.textContent = message;
        }
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
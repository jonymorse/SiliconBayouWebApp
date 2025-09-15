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
        
        // Enhanced properties for better world tracking
        this.isSwitching = false;
        this.motionPermissionRequested = false;
        this.sessionStabilized = false;
        
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

            // Add session state listeners for better debugging
            this.session.events.addEventListener("camera_input_started", () => {
                console.log('📹 Camera input started');
                this.sessionStabilized = false;
                // Give some time for session to stabilize
                setTimeout(() => {
                    this.sessionStabilized = true;
                    console.log('✅ Session stabilized');
                }, 1000);
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
    
    // Enhanced motion permission request
    async requestMotionPermissions() {
        if (this.motionPermissionRequested) return;
        
        console.log('🔄 Requesting motion permissions for better world tracking...');
        
        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            
            try {
                this.updateStatus('Requesting motion access...');
                const permission = await DeviceOrientationEvent.requestPermission();
                console.log('Motion permission result:', permission);
                
                if (permission === 'granted') {
                    console.log('✅ Motion permission granted - world tracking should be more stable');
                    this.updateStatus('Motion access granted!');
                    
                    // If we're on back camera with lens active, restart for better tracking
                    if (this.lensActive && this.currentFacingMode === 'environment') {
                        setTimeout(async () => {
                            await this.restabilizeWorldTracking();
                        }, 500);
                    }
                } else {
                    console.log('❌ Motion permission denied');
                    this.updateStatus('Motion access denied');
                }
                
                this.motionPermissionRequested = true;
                return permission;
            } catch (error) {
                console.error('Motion permission request failed:', error);
                return 'denied';
            }
        } else {
            // Non-iOS device
            console.log('Motion permissions not required on this device');
            this.motionPermissionRequested = true;
            return 'granted';
        }
    }

    // New method to restabilize world tracking
    async restabilizeWorldTracking() {
        if (!this.session || !this.currentLens || this.currentFacingMode !== 'environment') return;
        
        try {
            console.log('🔧 Restabilizing world tracking...');
            
            // Clear current lens
            await this.session.clearLens();
            
            // Wait for cleanup
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Reapply lens
            await this.session.applyLens(this.currentLens);
            
            // Extra stabilization time
            await new Promise(resolve => setTimeout(resolve, 800));
            
            console.log('✅ World tracking restabilized');
            this.updateStatus('AR tracking optimized!');
            
        } catch (error) {
            console.error('Failed to restabilize world tracking:', error);
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
    
    // Enhanced camera switching with world tracking considerations
    async switchCamera() {
        if (!this.session || this.isSwitching) {
            console.log('⏳ Camera switch already in progress or session not ready');
            return;
        }
        
        this.isSwitching = true;
        console.log('🔄 Starting enhanced camera switch...');
        
        try {
            // Store current state
            const wasLensActive = this.lensActive;
            const currentLensRef = this.currentLens;
            const oldFacingMode = this.currentFacingMode;
            
            this.updateStatus('Switching camera...');
            
            // Step 1: Properly pause session if possible
            try {
                if (this.session.pause) {
                    await this.session.pause();
                    console.log('📱 Session paused');
                }
            } catch (error) {
                console.log('Session pause not available, continuing...');
            }
            
            // Step 2: Clean up current state
            if (wasLensActive) {
                try {
                    await this.session.clearLens();
                    console.log('🧹 Lens cleared');
                } catch (error) {
                    console.log('Lens clear failed, continuing...');
                }
            }
            
            // Step 3: Stop media stream
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop());
                this.mediaStream = null;
                console.log('📹 Media stream stopped');
            }
            
            // Step 4: Wait for cleanup
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Step 5: Switch facing mode
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
            console.log(`📱 Switched from ${oldFacingMode} to ${this.currentFacingMode}`);
            
            // Step 6: Restart camera
            await this.startCamera();
            console.log('📹 Camera restarted');
            
            // Step 7: Wait for session to stabilize
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Step 8: Reapply lens with enhanced world tracking
            if (wasLensActive && currentLensRef) {
                await this.reapplyLensWithStabilization(currentLensRef);
            }
            
            // Step 9: Request motion permissions if switching to back camera
            if (this.currentFacingMode === 'environment' && !this.motionPermissionRequested) {
                setTimeout(async () => {
                    await this.requestMotionPermissions();
                }, 1000);
            }
            
            console.log('✅ Camera switch completed successfully');
            this.updateStatus('Camera switched!');
            
        } catch (error) {
            console.error('❌ Camera switch failed:', error);
            
            // Revert facing mode on failure
            this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
            this.updateStatus('Switch failed, retrying...');
            
            // Try to recover
            try {
                await this.startCamera();
            } catch (recoveryError) {
                console.error('Recovery failed:', recoveryError);
                this.updateStatus('Camera error');
            }
        } finally {
            this.isSwitching = false;
        }
    }

    // New method for lens reapplication with stabilization
    async reapplyLensWithStabilization(lensRef) {
        try {
            console.log('🎭 Reapplying lens with stabilization...');
            
            // For environment camera, add extra stabilization
            if (this.currentFacingMode === 'environment') {
                console.log('🌍 Environment camera detected - adding world tracking stabilization');
                await new Promise(resolve => setTimeout(resolve, 800));
            }
            
            // Apply the lens
            await this.session.applyLens(lensRef);
            this.lensActive = true;
            
            // Additional stabilization for world tracking
            if (this.currentFacingMode === 'environment') {
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log('🎯 World tracking stabilization complete');
            }
            
            console.log('✅ Lens reapplied successfully');
            this.updateStatus('AR active!');
            
        } catch (error) {
            console.error('❌ Failed to reapply lens:', error);
            this.lensActive = false;
            this.updateStatus('Lens reapply failed');
        }
    }    
    // Enhanced lens toggle with better world tracking
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
                
                // Request motion permissions first if on back camera
                if (this.currentFacingMode === 'environment' && !this.motionPermissionRequested) {
                    await this.requestMotionPermissions();
                }
                
                // Load lens
                this.currentLens = await this.cameraKit.lensRepository.loadLens(
                    LENS_CONFIG.LENS_ID, 
                    LENS_CONFIG.LENS_GROUP_ID
                );
                
                // Apply with stabilization
                await this.reapplyLensWithStabilization(this.currentLens);
            }
        } catch (error) {
            console.error('Lens error:', error);
            this.updateStatus(`Lens error: ${error.message}`);
            this.lensActive = false;
            this.currentLens = null;
        }
    }
    
    // Enhanced auto-start with motion permission timing
    async autoStartWithLens() {
        try {
            this.updateStatus('Auto-starting...');
            await this.startCamera();
            
            // Wait for camera to stabilize
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Apply lens first
            await this.toggleLens();
            
            // Then request motion permissions after lens is active (better UX)
            if (this.currentFacingMode === 'environment') {
                setTimeout(async () => {
                    await this.requestMotionPermissions();
                }, 2000); // Give user time to see the AR working first
            }
            
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
    
    // Enhanced double-tap with debouncing and switch protection
    handleDoubleTap() {
        const currentTime = Date.now();
        const tapLength = currentTime - this.lastTap;
        
        if (this.tapTimeout) {
            clearTimeout(this.tapTimeout);
            this.tapTimeout = null;
        }
        
        if (tapLength < 300 && tapLength > 0) {
            // Double tap detected
            if (this.isSwitching) {
                console.log('⏳ Camera switch in progress, ignoring double tap');
                return;
            }
            
            console.log('👆 Double tap detected - switching camera');
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

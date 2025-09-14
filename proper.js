import { bootstrapCameraKit, createMediaStreamSource, Transform2D } from '@snap/camera-kit';

const LENS_CONFIG = {
    API_TOKEN: 'eyJhbGciOiJIUzI1NiIsImtpZCI6IkNhbnZhc1MyU0hNQUNQcm9kIiwidHlwIjoiSldUIn0.eyJhdWQiOiJjYW52YXMtY2FudmFzYXBpIiwiaXNzIjoiY2FudmFzLXMyc3Rva2VuIiwibmJmIjoxNzU2MDg0MjEwLCJzdWIiOiJmODFlYmJhMC1iZWIwLTRjZjItOWJlMC03MzVhMTJkNGQxMWR-U1RBR0lOR345ZWY5YTc2Mi0zMTIwLTRiOTQtOTUwMy04NWFmZjc0MWU5YmIifQ.UR2iAXnhuNEOmPuk7-qsu8vD09mrRio3vNtUo0BNz8M',
    LENS_ID: '6f32833b-0365-4e96-8861-bb2b332a82ec',
    LENS_GROUP_ID: '1d5338a5-2299-44e8-b41d-e69573824971'
};

class SnapLensProper {
    constructor() {
        this.outputContainer = document.getElementById('canvas-output');
        this.statusEl = document.getElementById('status'); // optional status text element
        this.cameraKit = null;
        this.session = null;
        this.mediaStream = null;
        this.lensActive = false;
        this.currentLens = null;
        this.currentFacingMode = 'environment';
        this.lastTap = 0;
        this.tapTimeout = null;
        this.backgroundAudio = document.getElementById('backgroundAudio');

        // gesture-gated start flags
        this._started = false;
        this._starting = false;

        this.initializeApp();
    }

    async initializeApp() {
        this.setupDoubleTapGesture();
        this.setupBackgroundAudio();
        await this.initializeCameraKit();
        // NOTE: Do not auto-start; we will begin on first user gesture via ensureStartedOnce()
    }

    async initializeCameraKit() {
        try {
            this.updateStatus('Initializing...');
            this.cameraKit = await bootstrapCameraKit({ apiToken: LENS_CONFIG.API_TOKEN });
            this.session = await this.cameraKit.createSession();

            this.session.events.addEventListener('error', (event) => {
                console.error('Camera Kit error:', event.detail);
                this.updateStatus(`Error: ${event.detail}`);
            });

            // Replace placeholder with live canvas
            this.outputContainer.replaceWith(this.session.output.live);
            this.liveCanvas = this.session.output.live;
            this.liveCanvas.id = 'live-canvas';

            // Match CSS size
            this.liveCanvas.style.width = '100%';
            this.liveCanvas.style.height = '100%';
            this.liveCanvas.style.objectFit = 'cover';
            this.liveCanvas.style.background = '#000';
            this.liveCanvas.style.display = 'block';

            // Backing store scaling (iOS uses DPR=1 to avoid oversized UI)
            const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document);
            const dpr = isiOS ? 1 : Math.min(window.devicePixelRatio || 1, 2);

            const resizeLiveCanvas = () => {
                const rect = this.liveCanvas.getBoundingClientRect();
                this.liveCanvas.width = Math.round(rect.width * dpr);
                this.liveCanvas.height = Math.round(rect.height * dpr);
                console.log(`Canvas sized: ${this.liveCanvas.width}x${this.liveCanvas.height} (CSS: ${rect.width}x${rect.height}, DPR: ${dpr})`);
            };

            new ResizeObserver(resizeLiveCanvas).observe(this.liveCanvas.parentElement);
            window.addEventListener('orientationchange', resizeLiveCanvas);
            window.addEventListener('load', resizeLiveCanvas);
            resizeLiveCanvas();

            this.updateStatus('Tap to start camera');
        } catch (error) {
            console.error('Failed to initialize Camera Kit:', error);
            this.updateStatus(`Init error: ${error.message}`);
        }
    }

    // --- Gesture-gated one-time start --------------------------------------
    async ensureStartedOnce() {
        if (this._started || this._starting) return;
        this._starting = true;
        try {
            await this.startCamera();
            // Load & apply lens, then play (order matters)
            this.currentLens = await this.cameraKit.lensRepository.loadLens(
                LENS_CONFIG.LENS_ID,
                LENS_CONFIG.LENS_GROUP_ID
            );
            await this.session.applyLens(this.currentLens);
            this.lensActive = true;
            await this.session.play();
            this._started = true;
            this.updateStatus('AR active!');
        } catch (e) {
            console.error('Start failed:', e);
            this.updateStatus('Tap to start failed. Check permissions/HTTPS.');
        } finally {
            this._starting = false;
        }
    }

    // --- Media start (no play/apply here) -----------------------------------
    async startCamera() {
        this.updateStatus('Starting camera...');

        // Prefer selecting by deviceId when available (more reliable than facingMode)
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        const wantFront = this.currentFacingMode === 'user';
        const pickDeviceId = () => {
            const hit = videoDevices.find(d => wantFront ? /front/i.test(d.label) : /back|rear|environment/i.test(d.label));
            return hit?.deviceId;
        };

        const deviceId = pickDeviceId();
        const constraints = {
            video: deviceId ? { deviceId: { exact: deviceId }, frameRate: { ideal: 30, max: 30 } }
                            : { facingMode: wantFront ? 'user' : 'environment', frameRate: { ideal: 30, max: 30 } },
            audio: false
        };

        // Stop any previous stream
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }

        this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        const source = createMediaStreamSource(this.mediaStream, {cameraType: wantFront ? 'user' : 'environment'});
        await this.session.setSource(source);

        if (wantFront) source.setTransform(Transform2D.MirrorX);

        this.updateStatus('Camera ready!');
        return source;
    }

    async switchCamera() {
        if (!this.session) return;
        try {
            // Pause rendering to avoid race conditions
            await this.session.pause();

            // Flip target camera
            this.currentFacingMode = (this.currentFacingMode === 'user') ? 'environment' : 'user';

            // Stop old tracks and attach a fresh source
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(t => t.stop());
                this.mediaStream = null;
            }
            await this.startCamera();

            // Re-apply the lens BEFORE resuming playback (forces fresh tracking)
            if (this.lensActive && this.currentLens) {
                await this.session.applyLens(this.currentLens);
            }

            // Resume rendering
            await this.session.play();
        } catch (error) {
            console.error('Switch failed:', error);
            this.currentFacingMode = (this.currentFacingMode === 'user') ? 'environment' : 'user';
            this.updateStatus('Camera switch failed');
        }
    }

    async toggleLens() {
        if (!this.session) return;
        try {
            if (this.lensActive && this.currentLens) {
                await this.session.clearLens();
                this.lensActive = false;
                // Keep currentLens cached; re-apply quickly later
                this.updateStatus('Lens removed');
            } else {
                this.updateStatus('Loading lens...');
                if (!this.currentLens) {
                    this.currentLens = await this.cameraKit.lensRepository.loadLens(
                        LENS_CONFIG.LENS_ID,
                        LENS_CONFIG.LENS_GROUP_ID
                    );
                }
                await this.session.applyLens(this.currentLens);
                this.lensActive = true;
                this.updateStatus('AR active!');
            }
        } catch (error) {
            console.error('Lens error:', error);
            this.updateStatus(`Lens error: ${error.message}`);
            this.lensActive = false;
        }
    }

    setupDoubleTapGesture() {
        const cameraContainer = document.querySelector('.camera-container');
        if (!cameraContainer) return;

        const kickstart = async () => {
            if (!this._started) await this.ensureStartedOnce();
        };

        cameraContainer.addEventListener('touchend', async (e) => {
            e.preventDefault();
            await kickstart();
            this.handleDoubleTap();
        });

        cameraContainer.addEventListener('click', async (e) => {
            if (!e.target.closest('button')) {
                await kickstart();
                this.handleDoubleTap();
            }
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
            } catch (error) {
                console.error('Audio play failed:', error);
            }
        };

        document.addEventListener('touchstart', startAudio, { once: true });
        document.addEventListener('click', startAudio, { once: true });
        document.addEventListener('keydown', startAudio, { once: true });

        // Try autoplay; if blocked, gesture listeners above will handle it
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
            if (this._started) this.switchCamera();
            this.lastTap = 0;
        } else {
            this.lastTap = currentTime;
            this.tapTimeout = setTimeout(() => (this.lastTap = 0), 300);
        }
    }

    updateStatus(message) {
        if (this.statusEl) {
            this.statusEl.textContent = message;
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

// Bootstrap

document.addEventListener('DOMContentLoaded', () => {
    window.snapApp = new SnapLensProper();
});

window.addEventListener('beforeunload', () => {
    if (window.snapApp) {
        window.snapApp.destroy();
    }
});

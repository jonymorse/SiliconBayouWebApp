import {
  bootstrapCameraKit,
  createMediaStreamSource,
  Transform2D,
  remoteApiServicesFactory,
  ConcatInjectable,
} from '@snap/camera-kit';
import { CONFIG } from './config.js';

// ------- Remote API (ping only) -------
// 1) Put these near the top (below imports)
// top of file (you already have these)
// helpers
const toBytes = (o) => new TextEncoder().encode(JSON.stringify(o)); // Uint8Array
let hb = 0;
const log = (...a) => console.log("[RemoteAPI]", ...a);

const provideRemoteApi = () => ({
  apiSpecId: CONFIG.API_SPEC_ID,
  getRequestHandler(request) {
    const bodyLen = request?.body && (request.body.byteLength ?? request.body.length) || 0;
    log("REQ", `endpoint=${request.endpointId}`, `params=${JSON.stringify(request.parameters||{})}`, `body=${bodyLen}B`);

    if (request.endpointId === "ping") {
      const n = ++hb;
      const t0 = performance.now();
      return (reply) => {
        const body = toBytes({ pong: true, t: Date.now(), n });
        reply({
          status: "success",
          metadata: { n: String(n) },   // <-- string values only
          body,                         // <-- Uint8Array, not .buffer
        });
        log("RES", `ping #${n}`, `${Math.round(performance.now() - t0)}ms`);
      };
    }

    return undefined; // unhandled => Not Found (5) in Lens
  },
});



// ------- Canvas sizing helpers -------
// Set how you want to size the output
const RENDER_MODE = 'contain'; // 'contain' | 'cover' | 'fixed'
const TARGET_RATIO = 9 / 16;   // portrait 9:16 (swap to 16/9 for landscape)
const MAX_DPR = 2;             // cap DPR for perf; use 1 on very slow devices
const FIXED_PX = { width: 720, height: 1280 }; // used if RENDER_MODE==='fixed'

function setCanvasSize(canvas, cssW, cssH, dpr = 1.0) {
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

function fitContain(w, h, ratio) {
  // returns the largest rect that fits inside w×h with aspect=ratio
  let cw = w, ch = Math.round(cw / ratio);
  if (ch > h) { ch = h; cw = Math.round(ch * ratio); }
  return { w: cw, h: ch };
}
function fitCover(w, h, ratio) {
  // returns the smallest rect that covers w×h with aspect=ratio
  let cw = w, ch = Math.round(cw / ratio);
  if (ch < h) { ch = h; cw = Math.round(ch * ratio); }
  return { w: cw, h: ch };
}

async function start() {
  // 1) Bootstrap + register Remote API service
  const cameraKit = await bootstrapCameraKit(
    { apiToken: CONFIG.API_TOKEN, logger: 'console' },
    (container) => container.provides(ConcatInjectable(remoteApiServicesFactory.token, () => provideRemoteApi()))
  );

  // 2) Build/size our own canvas
  const app = document.getElementById('app');
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.position = 'absolute';
  canvas.style.left = 0; canvas.style.top = 0; // anchor in container
  app.style.position = 'relative';
  app.appendChild(canvas);

  const DPR = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  function resize() {
    const cw = app.clientWidth || window.innerWidth;
    const ch = app.clientHeight || window.innerHeight;

    if (RENDER_MODE === 'fixed') {
      setCanvasSize(canvas, FIXED_PX.width, FIXED_PX.height, DPR);
      // center it in the container
      canvas.style.left = ((cw - FIXED_PX.width) / 2) + 'px';
      canvas.style.top = ((ch - FIXED_PX.height) / 2) + 'px';
    } else if (RENDER_MODE === 'contain') {
      const s = fitContain(cw, ch, TARGET_RATIO);
      setCanvasSize(canvas, s.w, s.h, DPR);
      canvas.style.left = ((cw - s.w) / 2) + 'px';
      canvas.style.top = ((ch - s.h) / 2) + 'px';
    } else if (RENDER_MODE === 'cover') {
      const s = fitCover(cw, ch, TARGET_RATIO);
      setCanvasSize(canvas, s.w, s.h, DPR);
      canvas.style.left = ((cw - s.w) / 2) + 'px';
      canvas.style.top = ((ch - s.h) / 2) + 'px';
    }
  }
  window.addEventListener('resize', resize);
  resize();

  // 3) Session renders into OUR canvas
  const session = await cameraKit.createSession({ liveRenderTarget: canvas });
// after session = await cameraKit.createSession(...)
    window.ckSession = session; // so you can poke it in DevTools
    console.info("Camera Kit ready. Spec:", CONFIG.API_SPEC_ID);

  // 4) Control *input* resolution via getUserMedia if you want
  //    (browsers will pick closest supported; these are "ideals")
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },  // or 'user'
      width:  { ideal: FIXED_PX.width  },    // tune for your case; for portrait swap if needed
      height: { ideal: FIXED_PX.height },
      frameRate: { ideal: 30 },
      // aspectRatio: { ideal: TARGET_RATIO }, // some browsers honor this
    },
    audio: false,
  });

  // 5) Set media source & mirror if front camera
  const source = createMediaStreamSource(stream);
  const facing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
  if (facing === 'user') source.setTransform(Transform2D.MirrorX);
  await session.setSource(source);

  // 6) Load/apply lens & play
  const lens = await cameraKit.lensRepository.loadLens(CONFIG.LENS_ID, CONFIG.LENS_GROUP_ID);
  await session.applyLens(lens);
  session.play('live');

  // 7) Errors & cleanup
  session.events.addEventListener('error', (e) => console.error('[Lens error]', e.detail?.error || e));
  window.addEventListener('beforeunload', () => { try { stream.getTracks().forEach(t => t.stop()); } catch {} session.destroy?.(); });
  console.log('Camera Kit ready. Canvas size:', canvas.width + 'x' + canvas.height, 'DPR:', DPR);
}

document.addEventListener('DOMContentLoaded', () => {
  start().catch((err) => {
    console.error(err);
    const app = document.getElementById('app');
    app.style.color = '#fff'; app.style.display = 'grid'; app.style.placeItems = 'center';
    app.textContent = `Camera/Lens error: ${err?.message || err}`;
  });
});

// minimal-proper.js — get_state + set_state + ping
import {
  bootstrapCameraKit,
  createMediaStreamSource,
  remoteApiServicesFactory,
  ConcatInjectable,
} from '@snap/camera-kit';
import { CONFIG } from './config.js';

// ---------- Utilities ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
const toBytes = (o) => enc.encode(typeof o === 'string' ? o : JSON.stringify(o)); // Uint8Array
const log = (...a) => console.log('[RemoteAPI]', ...a);

// ---------- In-memory state (server-side truth while the page is open) ----------
let gameState = {
  names: ['Frog', 'Gator'],
  collected: { Frog: true, Gator: false, Pelican: false },
  t: 0,
};

// Small helpers to validate/merge incoming payloads safely
function sanitizeState(obj) {
  const names = Array.isArray(obj?.names) ? obj.names.map(String) : [];
  const collectedIn = obj?.collected && typeof obj.collected === 'object' ? obj.collected : {};
  const collected = {};
  // mark true for any name present; also copy any true flags in collectedIn
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

// ---------- Remote API provider ----------
let hb = 0; // ping counter

const provideRemoteApi = () => ({
  apiSpecId: CONFIG.API_SPEC_ID, // MUST match your portal spec
  getRequestHandler(request) {
    const bodyLen =
      (request?.body && (request.body.byteLength ?? request.body.length)) || 0;
    log(
      'REQ',
      `endpoint=${request.endpointId}`,
      `params=${JSON.stringify(request.parameters || {})}`,
      `body=${bodyLen}B`
    );

    // --- /ping ---
    if (request.endpointId === 'ping') {
      const n = ++hb;
      const t0 = performance.now();
      return (reply) => {
        reply({
          status: 'success',
          metadata: { n: String(n) }, // metadata values must be strings
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
          body: toBytes(gameState), // MUST be Uint8Array (not ArrayBuffer/string)
        });
        log('RES', `get_state`, `${Math.round(performance.now() - t0)}ms`);
      };
    }

    // --- /set_state ---
    if (request.endpointId === 'set_state') {
      const t0 = performance.now();
      return (reply) => {
        try {
          // Your Lens wrapper sends a required string parameter "payload".
          // (Ensure the portal spec declares payload:string REQUIRED.)
          let payloadStr = request.parameters?.payload;
          if (payloadStr == null) {
            // Fallback: some clients could send bytes in body
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

          reply({
            status: 'success',
            metadata: { count: String(gameState.names.length) },
            body: toBytes({ ok: true }),
          });
        } catch (e) {
          reply({
            status: 'server_error',
            metadata: {},
            body: toBytes(String(e?.message || e)),
          });
        } finally {
          log('RES', `set_state`, `${Math.round(performance.now() - t0)}ms`);
        }
      };
    }

    // Unknown endpoint → Not Found
    return undefined;
  },
});

async function start() {
  // 1) Camera Kit + register Remote API provider
  const cameraKit = await bootstrapCameraKit(
    { apiToken: CONFIG.API_TOKEN, logger: 'console' },
    (container) =>
      container.provides(
        ConcatInjectable(remoteApiServicesFactory.token, () => provideRemoteApi())
      )
  );
  console.info('[RemoteAPI] provider registered for spec:', CONFIG.API_SPEC_ID);

  // 2) Create session
  const session = await cameraKit.createSession();
  window.ckSession = session;

  // 3) Get camera media
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, frameRate: { ideal: 30 } },
    audio: false,
  });
  const source = createMediaStreamSource(stream);
  await session.setSource(source);

  // 4) Load lens + play
  const lens = await cameraKit.lensRepository.loadLens(
    CONFIG.LENS_ID,
    CONFIG.LENS_GROUP_ID
  );
  await session.applyLens(lens);

  // 5) Render to DOM
  document.getElementById('app').appendChild(session.output.live);
  session.play('live');

  // 6) Errors & cleanup
  session.events.addEventListener('error', (e) =>
    console.error('[Lens error]', e.detail?.error || e)
  );
  window.addEventListener('beforeunload', () => {
    try { stream.getTracks().forEach((t) => t.stop()); } catch {}
    session.destroy?.();
  });

  console.log('Camera Kit ready. Remote API (ping/get_state/set_state) live.');
}

document.addEventListener('DOMContentLoaded', () => {
  start().catch((err) => {
    console.error(err);
    const app = document.getElementById('app');
    app.style.color = '#fff';
    app.style.display = 'grid';
    app.style.placeItems = 'center';
    app.textContent = `Camera/Lens error: ${err?.message || err}`;
  });
});

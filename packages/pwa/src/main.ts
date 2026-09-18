import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './App.svelte';
import { PerchStore } from './store.svelte';
import { ConnectionManager } from './core/connection-manager';
import { WorkspaceAggregator } from './core/workspace-aggregator';
import { SettingsStore, type MachineConfig } from './core/settings-store';
import { LocalStorageAdapter } from './adapters/local-storage';
import { createConnectionLog } from './core/connection-log';
import { flushConnectionLog } from './core/connection-log-flush';
import { createStorageLogStore } from './adapters/storage-log-store';
import { browserSocketFactory } from './adapters/browser-socket';
import { MediaRecorderAudio } from './adapters/media-recorder-audio';
import { ElevenLabsTranscriber } from './adapters/elevenlabs-transcriber';
import { FetchImageLoader } from './adapters/fetch-image-loader';
import { VERSION_FILE, parseVersionJson } from './core/version-file';

// Poll for a new service worker every minute so an OPEN PWA learns about new builds.
// registerType is 'prompt': the new worker installs and waits instead of reloading on
// its own (iOS standalone never reliably auto-reloaded). When it's waiting, onNeedRefresh
// fires; we surface a banner and only reload when the user taps it (updateSW(true)).
const UPDATE_INTERVAL_MS = 60_000;

// The running app only has its own (now-stale) build identity baked in, so fetch the
// incoming build's label + id from the network-only version.json. Falls back to nulls
// (generic banner / no-op) on a failed or malformed response.
async function fetchVersion(): Promise<{ label: string | null }> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${VERSION_FILE}?ts=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return { label: null };
    return parseVersionJson(await res.json());
  } catch {
    return { label: null };
  }
}

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      setInterval(() => {
        void registration.update();
      }, UPDATE_INTERVAL_MS);
    }
  },
  onNeedRefresh() {
    void fetchVersion().then(({ label }) => store.notifyUpdateAvailable(label));
  },
});

const aggregator = new WorkspaceAggregator();

const storage = new LocalStorageAdapter();
const settings = new SettingsStore(storage);

let store: PerchStore;
const manager = new ConnectionManager({
  socketFactory: browserSocketFactory,
  aggregator,
  onMessage: (id, message) => store.handleMessage(id, message),
  onStatus: (id, status) => store.setStatus(id, status),
  onDiagnostic: (id, diagnostic) => store.setConnectionError(id, diagnostic),
});
const imageLoader = new FetchImageLoader();

// Durable connection-event log: buffers lifecycle events (with online/visibility context) and
// flushes them per-machine to the agent's POST /clientlog after a reconnect. crypto.randomUUID
// is available in the tailnet https (secure) context the PWA is served from.
const connectionLog = createConnectionLog({
  store: createStorageLogStore(storage),
  env: { now: () => Date.now(), readEnv: () => ({ online: navigator.onLine, vis: document.visibilityState }) },
  sess: crypto.randomUUID(),
});
const flushLog = (machine: MachineConfig): void => {
  // Map the machine's ws(s):// URL to its http(s):// origin (same host/port), like the /file fetch.
  const httpBase = machine.url.replace(/^ws/, 'http').replace(/\/+$/, '');
  void flushConnectionLog({
    log: connectionLog,
    machineId: machine.id,
    httpBase,
    token: machine.token,
    fetch: (input, init) => fetch(input, init),
    meta: { ua: navigator.userAgent, shell: 'pwa' },
  });
};

store = new PerchStore({
  settings,
  manager,
  aggregator,
  applyUpdate: () => void updateSW(true),
  recorder: new MediaRecorderAudio(),
  transcriber: new ElevenLabsTranscriber(() => settings.elevenLabsApiKey()),
  imageLoader,
  socketFactory: browserSocketFactory,
  connectionLog,
  flushLog,
});

// Pick up an image handed to us by the OS "Share" sheet (Android Web Share Target). The SW
// helper (public/share-target-sw.js) stashed it in the Cache API on the share POST; read it
// once at boot. Fire-and-forget so app boot never blocks on the Cache API. No-op where the
// Cache API is absent or no share happened. The entry is deleted only when the image is
// actually attached to a session (flush), so a re-open before attaching still surfaces it.
if ('caches' in self) {
  void caches.open('perch-shared').then((cache) => store.loadSharedFile(cache));
} else {
  void store.loadSharedFile(null);
}

const target = document.getElementById('app');
if (!target) {
  throw new Error('#app not found');
}
mount(App, { target, props: { store } });

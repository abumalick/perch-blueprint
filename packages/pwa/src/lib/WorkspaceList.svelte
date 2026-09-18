<script lang="ts">
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import { imageMediaType } from '@perch/contracts';
  import type { PerchStore } from '../store.svelte';
  import ProjectFilterSelect from './ProjectFilterSelect.svelte';
  import { BUILD_LABEL, isTestBuild } from '../core/build-label';
  import { displayProjectPath } from '../core/resolve-path';
  import { deriveProjectFolders, filterWorkspaces, pruneStaleFilter } from '../core/project-folders';
  import { motionDuration, REORDER_MS, ENTER_LEAVE_MS } from './motion';
  import { STATUS_LABELS } from './workspace-status-display';

  let { store, buildLabel = BUILD_LABEL }: { store: PerchStore; buildLabel?: string } =
    $props();

  // Suppress intro transitions on the first render. The PWA re-populates the whole
  // list on every (re)connect, so without this gate every pill would slide in on load
  // and on each reconnect. After mount, genuinely new pills animate in; reorders and
  // exits animate throughout.
  let ready = $state(false);
  $effect(() => {
    ready = true;
  });

  // Only worth disambiguating which machine a session lives on when more than one
  // machine is enabled (absent `enabled` counts as enabled).
  const showMachine = $derived(store.machines.filter((m) => m.enabled !== false).length > 1);
  const machineFor = (machineId: string) => store.machines.find((m) => m.id === machineId);
  const displayPath = (machineId: string, projectPath: string) =>
    displayProjectPath(machineFor(machineId)?.defaultPath, projectPath);

  // Project-folder filter pills. Persisted via the store (SettingsStore) so the
  // selection survives navigation and app reload. Empty selection shows every workspace.
  const selected = $derived(new Set(store.folderFilter));
  const folders = $derived(deriveProjectFolders(store.workspaces, store.machines));
  // Drop selected keys with no sessions left under them, so a vanished folder can't keep the
  // list filtered to nothing. If this empties the selection, the list falls back to showing all.
  // Gated on workspaces having actually loaded (non-empty) — store.workspaces starts empty on
  // every reload until the agent's async `list` reply arrives, and pruning before then would
  // wipe a persisted filter that just hasn't had a chance to apply yet.
  $effect(() => {
    const pruned = pruneStaleFilter(selected, store.workspaces, store.machines, store.workspaces.length > 0);
    if (pruned.length !== selected.size) store.setFolderFilter(pruned);
  });
  const visibleWorkspaces = $derived(filterWorkspaces(store.workspaces, store.machines, selected));
  // Agent-browser sessions attached to no workspace (e.g. a home-level per-site login
  // like `github`), listed per machine at the bottom of the home list.
  const browserSessions = $derived(store.unattachedBrowserSessions());
  const toggleFolder = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    store.setFolderFilter([...next]);
  };

  // Preview thumbnail for a file handed in via the OS "Share" sheet (Android). Held as an
  // object URL that's revoked when the pending file clears or changes, so it doesn't leak.
  // Only images get one — any other type would render as a broken-image icon.
  let sharedThumb = $state<string | null>(null);
  $effect(() => {
    const shared = store.pendingSharedFile;
    const mediaType = shared ? imageMediaType(shared.name) : '';
    if (!shared || !mediaType) {
      sharedThumb = null;
      return;
    }
    const url = URL.createObjectURL(new Blob([new Uint8Array(shared.bytes)], { type: mediaType }));
    sharedThumb = url;
    return () => URL.revokeObjectURL(url);
  });
</script>

<header>
  <h1>
    Perch
    {#if isTestBuild(buildLabel)}
      <span class="build-badge" title="Serving a test build">{buildLabel}</span>
    {/if}
  </h1>
  <div class="actions">
    <button type="button" class="icon" aria-label="New" onclick={() => store.goCreate()}>＋</button>
    <button type="button" class="icon" aria-label="Settings" onclick={() => store.goSettings()}>⚙</button>
  </div>
</header>

{#if store.pendingSharedFile}
  <div class="shared-banner" data-testid="shared-file-banner">
    {#if sharedThumb}
      <img class="shared-thumb" src={sharedThumb} alt="Shared preview" />
    {/if}
    <span class="shared-text">1 file ready — open a session to attach it</span>
  </div>
{/if}

{#if store.homeView === 'add-machine'}
  <div class="empty" data-testid="home-add-machine">
    <p class="empty-title">No machines yet</p>
    <p class="empty-sub">Connect a machine running the Perch agent to get started.</p>
    <button type="button" class="cta" onclick={() => store.goSettings()}>⚙ Add a machine</button>
  </div>
{:else if store.homeView === 'connecting'}
  <div class="empty" data-testid="home-connecting">
    <div class="spinner" aria-hidden="true"></div>
    <p class="empty-sub">Connecting to your machines…</p>
  </div>
{:else if store.homeView === 'reconnecting'}
  <!-- A machine that has connected before is auto-retrying — a calm state, no scary message
       and no prompt to tap: reconnection happens on its own. -->
  <div class="empty" data-testid="home-reconnecting">
    <div class="spinner" aria-hidden="true"></div>
    <p class="empty-sub">Reconnecting…</p>
  </div>
{:else if store.homeView === 'unreachable'}
  <div class="empty" data-testid="home-unreachable">
    <p class="empty-title">Can't reach your machines</p>
    <p class="empty-sub">Check that Tailscale is on, then reconnect.</p>
    <button type="button" class="cta" data-testid="reconnect-home" onclick={() => store.reconnectAll(true)}>Reconnect</button>
  </div>
{:else if store.homeView === 'create'}
  <div class="empty" data-testid="home-create">
    <p class="empty-title">No workspaces yet</p>
    <p class="empty-sub">Spin up a Claude session on one of your machines.</p>
    <button type="button" class="cta" onclick={() => store.goCreate()}>＋ Create your first workspace</button>
  </div>
{:else}
  <ProjectFilterSelect {folders} {selected} ontoggle={toggleFolder} />
  <ul>
    {#each visibleWorkspaces as ws (ws.machineId + ':' + ws.id)}
      <li
        animate:flip={{ duration: motionDuration(REORDER_MS) }}
        in:slide={{ duration: ready ? motionDuration(ENTER_LEAVE_MS) : 0 }}
        out:slide={{ duration: motionDuration(ENTER_LEAVE_MS) }}
      >
        <button
          type="button"
          class="row"
          data-status={ws.status}
          aria-current={ws.id === store.active?.id ? 'true' : undefined}
          onclick={() => store.open(ws)}
        >
          <span class="body">
            <span class="path-line">
              <span class="path">{displayPath(ws.machineId, ws.projectPath)}</span>
              {#if showMachine && machineFor(ws.machineId)?.name}
                <span class="machine">{machineFor(ws.machineId)?.name}</span>
              {/if}
              {#if ws.agentAddress}
                <span class="agent-address" data-testid="agent-address" title="Address other Claude sessions message this one by">{ws.agentAddress}</span>
              {/if}
              <span class="badge" data-status={ws.status}>{STATUS_LABELS[ws.status]}</span>
              <span class="chev" aria-hidden="true">›</span>
            </span>
            <span class="name-line">
              {#if ws.urgent}
                <span class="urgent-star" aria-label="Urgent" title="Urgent">★</span>
              {/if}
              <span class="name">{ws.name}</span>
            </span>
          </span>
        </button>
      </li>
    {/each}
  </ul>
  {#if browserSessions.length > 0}
    <section class="browser-sessions">
      <h2>Browser sessions</h2>
      <ul>
        {#each browserSessions as s (s.connectionId + ':' + s.name)}
          <li>
            <button type="button" class="row session-row" onclick={() => store.openBrowserView(s.connectionId, s.name)}>
              <span class="session-icon" aria-hidden="true">🌐</span>
              <span class="session-name">{s.name}</span>
              {#if showMachine && machineFor(s.connectionId)?.name}
                <span class="machine">{machineFor(s.connectionId)?.name}</span>
              {/if}
              <span class="chev" aria-hidden="true">›</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/if}

<style>
  header { display: flex; justify-content: space-between; align-items: center; }
  h1 { font-size: 1.5rem; }
  .build-badge {
    font-size: 0.7rem;
    font-weight: 600;
    vertical-align: middle;
    margin-left: 0.4rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.6rem;
    background: #4a3a10;
    color: #f0c040;
  }
  .actions { display: flex; gap: 0.5rem; }
  .actions button.icon {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 22px;
    line-height: 1;
    touch-action: manipulation;
  }
  .actions button.icon:active { background: var(--surface-press); }

  /* Calm notice that an OS-shared image is waiting to be attached; tapping any session below
     delivers it. Uses the accent tint so it reads as an actionable prompt, not an error. */
  .shared-banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 1rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--attention-tint);
  }
  .shared-thumb {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 4px;
  }
  .shared-text { font-size: 0.85rem; color: var(--text); }

  .empty { text-align: center; padding: 3rem 1rem; }
  .spinner {
    width: 28px;
    height: 28px;
    margin: 0 auto 1rem;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  /* Honor reduced-motion: drop the spin, keep the ring as a static indicator. */
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: none; }
  }
  .empty-title { margin: 0; font-size: 1.1rem; font-weight: 600; }
  .empty-sub { margin: 0.4rem 0 1.25rem; color: var(--text-dim); }
  .cta {
    min-height: 44px;
    padding: 0 1.1rem;
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font-size: 0.95rem;
    font-weight: 600;
    touch-action: manipulation;
  }
  .cta:active { background: var(--accent-press); }

  ul { list-style: none; padding: 0; margin: 1rem 0 0; display: flex; flex-direction: column; gap: 0.5rem; }

  /* The row is the unit the user scans. A colored left rail + badge encode the one
     thing they're deciding on — which session needs them — so the differentiator,
     not the chrome, carries the visual weight. */
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    min-height: 64px;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--border);
    border-left: 3px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    touch-action: manipulation;
  }
  .row:active { background: var(--surface-press); }
  /* The currently-open workspace, highlighted so the persistent sidebar (wide layout)
     shows which session the right pane is rendering. Harmless on mobile, where the list
     is hidden while a workspace is open. */
  .row[aria-current='true'] { background: var(--surface-press); border-color: var(--accent); }
  .row[data-status='needs-feedback'] { border-left-color: var(--attention); background: var(--attention-tint); }
  .row[data-status='needs-hands'] { border-left-color: var(--hands); }
  .row[data-status='finished'] { border-left-color: var(--ok); }
  .row[data-status='working'] { border-left-color: var(--accent); }
  .row[data-status='review'] { border-left-color: var(--warn); }
  .row[data-status='blocked'] { border-left-color: var(--danger); }
  .row[data-status='idle'] { border-left-color: var(--idle); }
  /* Parked stays a muted gray rail so it reads as quiet, tucked near the bottom. */
  .row[data-status='parked'] { border-left-color: var(--text-dim); }

  .body { flex: 1; min-width: 0; display: grid; gap: 0.15rem; }
  /* min-width: 0 lets this grid item shrink so the long-name ellipsis engages; without it
     a long workspace name pushes the row past the viewport and the page scrolls sideways. */
  .name-line { display: flex; align-items: center; gap: 0.45rem; min-width: 0; }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Urgent pin marker: a small filled star before the name, in the attention color so it
     reads as "this one's been flagged up". flex: 0 0 auto so it never shrinks. */
  .urgent-star { flex: 0 0 auto; color: var(--attention); font-size: 0.85rem; line-height: 1; }
  .path-line { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
  /* Muted pill on the path line — quieter than the attention badge so it doesn't compete
     with the "Needs you" signal. flex: 0 0 auto so it never squeezes the path's ellipsis. */
  .machine {
    flex: 0 0 auto;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-dim);
    background: var(--surface-press);
    border: 1px solid var(--border);
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The agent address is an identifier the user retypes into an instruction for another
     session, so it is monospace and never abbreviated by ellipsis mid-token. It shrinks
     the path rather than itself when the row is tight. */
  .agent-address {
    flex: 0 0 auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.7rem;
    color: var(--text-dim);
    background: var(--surface-press);
    border: 1px solid var(--border);
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* flex: 0 1 auto — size to the folder text (so the machine pill sits snug right after it)
     but still shrink to ellipsis when the path is long enough to crowd the pill. */
  .path { flex: 0 1 auto; min-width: 0; color: var(--text-dim); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* margin-left: auto right-aligns the badge + chevron at the end of the first line,
     while the folder and machine pill stay packed at the start. */
  .badge { flex: 0 0 auto; margin-left: auto; font-size: 0.78rem; font-weight: 600; color: var(--text-dim); }
  .badge[data-status='finished'] { color: var(--ok); }
  .badge[data-status='working'] { color: var(--accent); }
  .badge[data-status='review'] { color: var(--warn); }
  .badge[data-status='blocked'] { color: var(--danger); }
  .badge[data-status='idle'] { color: var(--idle); }
  .badge[data-status='needs-hands'] { color: var(--hands); }
  .badge[data-status='needs-feedback'] {
    color: var(--attention);
    background: var(--attention-tint);
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
  }

  .chev { flex: 0 0 auto; color: var(--text-dim); font-size: 1.3rem; line-height: 1; }

  /* Unattached browser sessions: a quiet bucket under the workspaces. */
  .browser-sessions { margin-top: 1.25rem; }
  .browser-sessions h2 { margin: 0 0 0.5rem; font-size: 0.85rem; font-weight: 600; color: var(--text-dim); }
  .session-row { min-height: 48px; }
  .session-icon { flex: 0 0 auto; }
  .session-name { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

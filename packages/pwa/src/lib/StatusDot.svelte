<script lang="ts">
  import type { ConnectionStatus } from '../core/machine-connection';

  let { status }: { status: ConnectionStatus | 'off' } = $props();
  const color = $derived(
    status === 'online'
      ? 'var(--ok)'
      : status === 'connecting'
        ? 'var(--warn)'
        : status === 'off'
          ? 'var(--text-dim)'
          : 'var(--danger)',
  );
</script>

<span class="dot" class:connecting={status === 'connecting'} title={status} style:background-color={color}></span>

<style>
  .dot {
    display: inline-block;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  /* A slow pulse signals the app is actively trying to reach the machine. */
  .connecting { animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  @media (prefers-reduced-motion: reduce) {
    .connecting { animation: none; }
  }
</style>

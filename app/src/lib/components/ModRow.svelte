<script lang="ts">
  import type { ModEntry } from '$lib/api';
  import Toggle from './Toggle.svelte';

  let {
    mod,
    selected = false,
    onselect,
    ontoggle,
  }: {
    mod: ModEntry;
    selected?: boolean;
    onselect?: () => void;
    ontoggle?: (next: boolean) => void;
  } = $props();
</script>

<button
  type="button"
  class="row"
  class:selected
  onclick={(e) => {
    // ignore clicks that land on the switch itself — it manages its own state
    if ((e.target as HTMLElement).closest('.hw-switch')) return;
    onselect?.();
  }}
  onkeydown={(e) => { if (e.key === 'Enter') onselect?.(); }}
>
  {#if selected}<span class="rail"></span>{/if}
  <span class="grow text-left min-w-0">
    <span class="flex items-baseline gap-2">
      <span class="font-display font-semibold text-[15px] text-paper truncate">{mod.name}</span>
      <span class="text-[11px] text-mist-400 font-display">v{mod.version}</span>
      {#if !mod.hotToggle}
        <span class="text-[10px] text-mist-400 border border-bench-600 rounded px-1 py-px font-display" title="This mod can't be toggled live — it re-applies on next game launch">restart</span>
      {/if}
    </span>
    <span class="block text-[12px] text-mist-400 truncate mt-0.5">
      {mod.author}
      {#if mod.tags.length}
        <span class="text-bench-500 mx-1">/</span>{mod.tags.join(' ')}
      {/if}
    </span>
  </span>
  <span>
    <Toggle checked={mod.enabled} label="Toggle {mod.name}" onchange={ontoggle} />
  </span>
</button>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px 10px 14px;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    border: 1px solid transparent;
  }
  .row:hover { background: var(--color-bench-850); border-color: var(--color-bench-700); }
  .row.selected { background: var(--color-bench-800); border-color: var(--color-bench-600); }
  .rail {
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 2px;
    background: var(--color-hazard);
  }
</style>

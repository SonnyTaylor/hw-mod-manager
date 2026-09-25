<script lang="ts">
  import type { SettingField, SettingsValues } from '$lib/api';

  /**
   * Schema-driven settings form. Auto-saves (debounced) via onsave whenever a
   * control changes — values are persisted to state.json and hot-pushed into
   * the running game through the command channel.
   */
  let {
    fields,
    values,
    onsave,
  }: {
    fields: SettingField[];
    values: SettingsValues;
    onsave: (next: SettingsValues) => void;
  } = $props();

  // draft is seeded once per mount — the parent re-keys this component on mod change
  // svelte-ignore state_referenced_locally
  let draft: SettingsValues = $state(structuredClone(values));

  let timer: ReturnType<typeof setTimeout> | undefined;

  function touch(key: string, value: unknown) {
    draft[key] = value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      onsave({ ...draft });
    }, 250);
  }

  const num = (f: SettingField, fallback: number) =>
    typeof draft[f.id] === 'number' ? (draft[f.id] as number) : (typeof f.default === 'number' ? f.default : fallback);
</script>

<div class="space-y-3">
  {#each fields as f (f.id)}
    <div class="flex items-center justify-between gap-4 min-h-[34px]">
      <label class="text-[13px] text-mist-200 shrink-0" for="sf-{f.id}">{f.label}</label>

      {#if f.type === 'toggle'}
        <input id="sf-{f.id}" type="checkbox" class="hw-check" checked={!!draft[f.id]} onchange={(e) => touch(f.id, e.currentTarget.checked)} />
      {:else if f.type === 'select'}
        <select
          id="sf-{f.id}"
          class="text-[13px] px-2 py-1.5 min-w-[160px]"
          value={(draft[f.id] as string) ?? (f.default as string) ?? ''}
          onchange={(e) => touch(f.id, e.currentTarget.value)}
        >
          {#each f.options ?? [] as o}
            <option value={o.value}>{o.label}</option>
          {/each}
        </select>
      {:else if f.type === 'slider'}
        <div class="flex items-center gap-3 min-w-[220px]">
          <input
            id="sf-{f.id}"
            type="range"
            min={f.min ?? 0}
            max={f.max ?? 1}
            step={f.step ?? 0.01}
            value={num(f, 0)}
            oninput={(e) => touch(f.id, e.currentTarget.valueAsNumber)}
          />
          <span class="font-display text-[12px] text-mist-300 w-14 text-right tabular-nums">
            {num(f, 0)}{f.unit ?? ''}
          </span>
        </div>
      {:else if f.type === 'number'}
        <input
          id="sf-{f.id}"
          type="number"
          class="text-[13px] px-2 py-1.5 w-24"
          value={(draft[f.id] as number) ?? (f.default as number) ?? 0}
          oninput={(e) => touch(f.id, e.currentTarget.valueAsNumber)}
        />
      {:else if f.type === 'color'}
        <input
          id="sf-{f.id}"
          type="color"
          class="h-8 w-12 rounded border border-bench-600 bg-bench-800 cursor-pointer"
          value={(draft[f.id] as string) ?? (f.default as string) ?? '#ff7a1a'}
          oninput={(e) => touch(f.id, e.currentTarget.value)}
        />
      {:else}
        <input
          id="sf-{f.id}"
          type="text"
          class="text-[13px] px-2 py-1.5 w-48"
          value={(draft[f.id] as string) ?? (f.default as string) ?? ''}
          oninput={(e) => touch(f.id, e.currentTarget.value)}
        />
      {/if}
    </div>
  {/each}

  <p class="text-[11px] text-mist-400 pt-1 border-t border-bench-800">
    Changes save automatically and apply live to the running game.
  </p>
</div>

<style>
  .hw-check {
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    background: var(--color-bench-800);
    border: 1px solid var(--color-bench-600);
    cursor: pointer;
    display: grid;
    place-content: center;
  }
  .hw-check:checked { background: var(--color-hazard); border-color: var(--color-hazard); }
  .hw-check:checked::before {
    content: '';
    width: 10px;
    height: 6px;
    border-left: 2px solid #16181d;
    border-bottom: 2px solid #16181d;
    transform: rotate(-45deg) translateY(-1px);
  }
</style>

<script lang="ts">
  import { api, type GameInfo, type ModEntry, type SettingsValues } from '$lib/api';
  import ModRow from '$lib/components/ModRow.svelte';
  import SettingsForm from '$lib/components/SettingsForm.svelte';

  type Tab = 'mods' | 'marketplace';

  let game = $state<GameInfo | null>(null);
  let mods = $state<ModEntry[]>([]);
  let selectedId = $state<string | null>(null);
  let tab = $state<Tab>('mods');
  let search = $state('');
  let busy = $state('');
  let notice = $state<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  let editingPath = $state(false);
  let pathDraft = $state('');
  let launching = $state(false);

  const selected = $derived(mods.find((m) => m.id === selectedId) ?? null);
  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mods;
    return mods.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.author.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  });
  const enabledCount = $derived(mods.filter((m) => m.enabled).length);

  async function say(kind: 'ok' | 'bad', text: string) {
    notice = { kind, text };
    setTimeout(() => { if (notice?.text === text) notice = null; }, 3500);
  }

  async function refresh() {
    try {
      game = await api.gameInfo();
      mods = await api.listMods();
      if (!selected && mods.length) selectedId = mods[0].id;
    } catch (e) {
      void say('bad', String(e));
    }
  }

  $effect(() => { void refresh(); });

  async function toggleMod(mod: ModEntry, next: boolean) {
    mod.enabled = next;
    try {
      await api.setModEnabled(mod.id, next);
      void say('ok', next ? `${mod.name} enabled` : `${mod.name} disabled`);
    } catch (e) {
      mod.enabled = !next;
      void say('bad', String(e));
    }
  }

  async function saveSettings(mod: ModEntry, values: SettingsValues) {
    try {
      await api.setModSettings(mod.id, values);
    } catch (e) {
      void say('bad', String(e));
    }
  }

  async function launch() {
    launching = true;
    busy = 'launching…';
    try {
      await api.launch();
      void say('ok', 'Launch request sent to Steam');
    } catch (e) {
      void say('bad', String(e));
    } finally {
      launching = false;
      busy = '';
    }
  }

  async function savePath() {
    try {
      game = await api.setGamePath(pathDraft.trim() || null);
      editingPath = false;
      await refresh();
    } catch (e) {
      void say('bad', String(e));
    }
  }

  const patchStatus = $derived.by(() => {
    if (!game) return null;
    if (!game.found) return 'missing';
    if (game.asarPatched && game.binaryPatched) return 'patched';
    return 'unpatched';
  });
</script>

<div class="flex flex-col h-screen select-none">
  <!-- ── Header ─────────────────────────────────────────────── -->
  <header class="flex items-center gap-4 px-5 h-16 border-b border-bench-700 bg-bench-900">
    <div class="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" stroke="var(--color-hazard)" stroke-width="2.5" />
        <circle cx="12" cy="12" r="2.6" fill="var(--color-paper)" />
        <path d="M12 3v6.4M12 14.6V21M3 12h6.4M14.6 12H21" stroke="var(--color-hazard)" stroke-width="2" stroke-linecap="round" />
      </svg>
      <div>
        <h1 class="font-display font-bold text-[15px] tracking-[0.08em] leading-none">HW MOD MANAGER</h1>
        <p class="text-[10px] text-mist-400 font-display mt-0.5 tracking-[0.14em]">HAPPY WHEELS · BENCH</p>
      </div>
    </div>

    <nav class="ml-4" aria-label="Sections">
      <div class="flex gap-1" role="tablist">
      {#each ['mods', 'marketplace'] as t}
        <button
          type="button"
          role="tab"
          aria-selected={tab === t}
          class="font-display text-[12px] tracking-[0.1em] px-3.5 py-1.5 rounded-md transition-colors
            {tab === t ? 'bg-bench-700 text-paper' : 'text-mist-400 hover:text-mist-200'}"
          onclick={() => (tab = t as Tab)}
        >
          {t === 'mods' ? 'MODS' : 'MARKETPLACE'}
        </button>
      {/each}
      </div>
    </nav>

    <div class="grow"></div>

    {#if game}
      <div class="flex items-center gap-2 font-display text-[11px] text-mist-300" title={game.path}>
        <span class="dot {game.found ? 'dot-ok' : 'dot-bad'}"></span>INSTALL
        <span class="dot {patchStatus === 'patched' ? 'dot-ok' : patchStatus === 'missing' ? 'dot-bad' : 'dot-warn'}"></span>PATCH
        <span class="dot {mods.length ? 'dot-ok' : 'dot-warn'}"></span>MODS
      </div>
      <button
        type="button"
        class="font-display font-bold text-[13px] tracking-[0.1em] px-5 py-2 rounded-md bg-hazard text-bench-950
          hover:bg-hazard-soft active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={!game.found || launching}
        onclick={launch}
      >
        LAUNCH
      </button>
    {/if}
  </header>

  <!-- ── Body ───────────────────────────────────────────────── -->
  <main class="grow min-h-0 flex">
    {#if tab === 'mods'}
      <!-- Mod list -->
      <section class="w-[340px] flex-none border-r border-bench-700 bg-bench-900 flex flex-col min-h-0">
        <div class="px-4 pt-4 pb-2">
          <input
            type="text"
            placeholder="Search mods…"
            class="w-full text-[13px] px-3 py-2 placeholder:text-mist-400"
            bind:value={search}
          />
          <p class="text-[11px] text-mist-400 font-display mt-2 tracking-[0.06em]">
            {enabledCount}/{mods.length} ENABLED{busy ? ` — ${busy}` : ''}
          </p>
        </div>
        <div class="grow overflow-y-auto px-2 pb-3">
          {#if mods.length === 0}
            <div class="px-4 pt-10 text-[13px] text-mist-400 leading-relaxed">
              {#if game?.found}
                No mods installed yet. Copy mod folders into the game's
                <code class="text-mist-200">mods</code> directory or drop them in with the folder button.
              {:else}
                No game install detected. Set the game folder to get started.
              {/if}
            </div>
          {:else}
            {#each filtered as mod (mod.id)}
              <ModRow
                {mod}
                selected={mod.id === selectedId}
                onselect={() => (selectedId = mod.id)}
                ontoggle={(next) => toggleMod(mod, next)}
              />
            {/each}
          {/if}
        </div>
        <div class="px-4 py-3 border-t border-bench-700 flex items-center gap-3 text-[12px]">
          <button type="button" class="text-mist-400 hover:text-paper font-display tracking-[0.08em]" onclick={() => api.openModsDir().catch((e) => say('bad', String(e)))}>
            OPEN MODS FOLDER
          </button>
        </div>
      </section>

      <!-- Detail pane -->
      <section class="grow min-w-0 overflow-y-auto bg-bench-950">
        {#if selected}
          <div class="px-7 py-6 max-w-[640px]">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 class="font-display font-bold text-[22px] leading-tight">{selected.name}</h2>
                <p class="text-[12px] text-mist-400 mt-1">
                  v{selected.version} — {selected.author}
                  {#if selected.tags.length}
                    <span class="text-bench-500 mx-1.5">/</span>
                    {#each selected.tags as t}<span class="mr-1.5">{t}</span>{/each}
                  {/if}
                </p>
              </div>
              <div class="text-right shrink-0 font-display text-[11px] tracking-[0.08em]">
                {#if selected.hotToggle}
                  <span class="text-ok">HOT TOGGLE</span>
                {:else}
                  <span class="text-mist-400">APPLIES ON LAUNCH</span>
                {/if}
              </div>
            </div>

            {#if selected.description}
              <p class="text-[13.5px] text-mist-200 leading-relaxed mt-4 max-w-[60ch]">{selected.description}</p>
            {/if}

            {#if !selected.manifestOk}
              <div class="mt-4 text-[12px] text-bad flex items-center gap-2">
                <span class="dot dot-bad"></span>Invalid or missing mod.json — using folder name
              </div>
            {/if}

            {#if selected.requires.length}
              <div class="mt-4 flex items-center gap-2 text-[12px] text-mist-400">
                needs libs:
                {#each selected.requires as r}<code class="text-mist-200 bg-bench-800 rounded px-1.5 py-0.5">{r}</code>{/each}
              </div>
            {/if}

            {#if selected.settingsSchema.length}
              <div class="mt-7">
                <h3 class="font-display text-[12px] tracking-[0.12em] text-mist-400 mb-3">SETTINGS</h3>
                {#key selected.id}
                  <SettingsForm
                    fields={selected.settingsSchema}
                    values={selected.settings}
                    onsave={(v) => saveSettings(selected, v)}
                  />
                {/key}
              </div>
            {/if}

            <p class="text-[11px] text-mist-400 mt-8">
              Folder: <code class="text-mist-300">{selected.id}</code>
            </p>
          </div>
        {:else}
          <!-- Game overview when no mod is selected -->
          <div class="px-7 py-6 max-w-[560px]">
            <h2 class="font-display font-bold text-[22px]">Happy Wheels</h2>
            <p class="text-[12px] text-mist-400 mt-1">Install overview</p>

            <div class="mt-6 space-y-3 text-[13px]">
              <div class="flex items-center gap-2.5">
                <span class="dot {game?.found ? 'dot-ok' : 'dot-bad'}"></span>
                <span>Game install {game?.found ? 'found' : 'not found'}</span>
              </div>
              <div class="flex items-center gap-2.5">
                <span class="dot {patchStatus === 'patched' ? 'dot-ok' : patchStatus === 'missing' ? 'dot-bad' : 'dot-warn'}"></span>
                <span>Mod host patch {patchStatus === 'patched' ? 'applied' : patchStatus === 'missing' ? 'unknown' : 'not applied — run `node tools/hw.js dev` once'}</span>
              </div>
              <div class="flex items-center gap-2.5">
                <span class="dot {mods.length ? 'dot-ok' : 'dot-warn'}"></span>
                <span>{mods.length} mod{mods.length === 1 ? '' : 's'} installed</span>
              </div>
            </div>

            <div class="mt-7">
              <p class="text-[11px] font-display tracking-[0.12em] text-mist-400 mb-2">GAME FOLDER</p>
              <div class="flex items-center gap-2">
                {#if editingPath}
                  <input type="text" class="text-[12px] px-2 py-1.5 grow" bind:value={pathDraft} placeholder="/path/to/Happy Wheels" />
                  <button type="button" class="btn-ghost text-hazard" onclick={savePath}>SAVE</button>
                  <button type="button" class="btn-ghost" onclick={() => (editingPath = false)}>CANCEL</button>
                {:else}
                  <code class="text-[12px] text-mist-300 break-all">{game?.path ?? 'detecting…'}</code>
                  <button
                    type="button"
                    class="btn-ghost ml-auto"
                    onclick={() => { pathDraft = game?.path ?? ''; editingPath = true; }}
                  >CHANGE</button>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      </section>
    {:else}
      <!-- Marketplace (v2 placeholder with the plan spelled out) -->
      <section class="grow overflow-y-auto px-7 py-6 max-w-[720px]">
        <h2 class="font-display font-bold text-[22px]">Marketplace</h2>
        <p class="text-[13px] text-mist-200 mt-3 leading-relaxed max-w-[60ch]">
          One-click mod installs from the community index. The pipeline: a community git
          repository hosts <code class="text-mist-300">index.json</code> — mod metadata plus download
          links to zip packages. This tab fetches it, shows mods with screenshots and ratings,
          and installs them straight into the game's mods folder.
        </p>
        <ul class="mt-5 space-y-2.5 text-[13px] text-mist-300">
          <li class="flex gap-2.5"><span class="text-hazard font-display">01</span>Creators publish mods by PR-ing to the index repo (template scaffolds it).</li>
          <li class="flex gap-2.5"><span class="text-hazard font-display">02</span>The manager reads the index — search, tags, version, update checks.</li>
          <li class="flex gap-2.5"><span class="text-hazard font-display">03</span>Install = download zip, extract, scan. No game restart required.</li>
        </ul>
        <p class="text-[12px] text-mist-400 mt-6 font-display tracking-[0.1em]">SHIPPING IN THE NEXT MILESTONE</p>
      </section>
    {/if}
  </main>

  <!-- ── Status bar ─────────────────────────────────────────── -->
  <footer class="h-9 flex-none flex items-center px-5 border-t border-bench-700 bg-bench-900 text-[11px] font-display tracking-[0.05em]">
    {#if notice}
      <span class={notice.kind === 'ok' ? 'text-ok' : 'text-bad'}>{notice.text}</span>
    {:else}
      <span class="text-bench-500">
        {game?.found ? game.modsDir : 'Happy Wheels install not detected'}
      </span>
    {/if}
  </footer>
</div>

<style>
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .dot-ok { background: var(--color-ok); }
  .dot-warn { background: var(--color-hazard); }
  .dot-bad { background: var(--color-bad); }
  .btn-ghost {
    font-family: var(--font-display);
    font-size: 11px;
    letter-spacing: 0.08em;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid var(--color-bench-600);
    color: var(--color-mist-300);
    cursor: pointer;
    white-space: nowrap;
  }
  .btn-ghost:hover { color: var(--color-paper); border-color: var(--color-bench-500); }
  .btn-ghost:hover.text-hazard { border-color: var(--color-hazard); }
</style>

/**
 * Skin Packs — native game texture swapping.
 *
 * A pack lives in mods/skin-packs/packs/<id>/ with a skin.json:
 *   { "name": "Night Shift",
 *     "author": "...",
 *     "replace": { "<game asset path>": "<local file in the pack>" } }
 * e.g. "replace": { "animate/backgrounds/backgrounds_atlas_1/backgrounds_atlas_1.png": "bg1.png" }
 *
 * Asset paths are matched as suffixes against cached PIXI texture URLs
 * (the game prefixes everything with assets-<hash>/). The replacement PNG
 * MUST be the same pixel size as the original — frame rects stay valid.
 *
 * Mechanism: the pack image is drawn to a canvas and assigned as the cached
 * Texture's baseTexture in place — every sprite referencing that texture
 * (present and future) picks it up. Originals are kept for restore.
 *
 * Requires: game, ui.
 */
(function () {
    'use strict';
    const HW = window.__HW__;
    const packs = window.__HW__.skinPacks || [];
    if (!packs.length) { HW.log('skin-packs', 'no packs synced — add packs to mods/skin-packs/packs/'); return; }

    const STORE = 'skin-packs';
    let panel = null;
    let applied = []; // [{ tex, origBase, origUrl }] for restore
    let activeId = null;

    function findTexBySuffix(suffix) {
        const pixi = HW.require(99430);
        const hits = [];
        for (const t of Object.values(pixi.WpD.TextureCache)) {
            const r = t && t.baseTexture && t.baseTexture.resource;
            const u = (r && (r.url || r.src)) || '';
            if (u.endsWith(suffix)) hits.push(t);
        }
        return hits;
    }

    async function applyPack(p) {
        const pixi = HW.require(99430);
        restore();
        let appliedCount = 0, skipped = [];
        for (const [gamePath, localFile] of Object.entries(p.replace || {})) {
            const texes = findTexBySuffix(gamePath);
            if (!texes.length) { skipped.push(gamePath + ' (not loaded yet)'); continue; }
            // load replacement
            const url = `./js/hw-skin-packs/${p.id}/${localFile}`;
            const blob = await (await fetch(url)).blob();
            const objUrl = URL.createObjectURL(blob);
            const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(localFile + ' failed to load')); i.src = objUrl; });
            URL.revokeObjectURL(objUrl);
            for (const tex of texes) {
                const w = tex.baseTexture.width, h = tex.baseTexture.height;
                if (img.width !== w || img.height !== h) {
                    skipped.push(`${localFile} (${img.width}x${img.height} ≠ ${w}x${h})`);
                    continue;
                }
                const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0);
                const origBase = tex.baseTexture;
                tex.baseTexture = pixi.gPd.from(canvas).baseTexture;
                tex.update();
                applied.push({ tex, origBase });
                appliedCount++;
            }
        }
        activeId = p.id;
        return { appliedCount, skipped };
    }

    function restore() {
        for (const { tex, origBase } of applied) {
            try { tex.baseTexture = origBase; tex.update(); } catch (e) {}
        }
        applied = [];
        activeId = null;
    }

    HW.onDisable(() => { restore(); panel && panel.destroy && panel.destroy(); });

    HW.onReady(() => {
        panel = window.HWLibs.ui.panel({ title: 'Skin Packs', storageKey: 'skinpacks', width: 240 });
        const sec = panel.addSection('Packs');
        const saved = window.HWLibs.settings.get(STORE, 'pack', null);
        for (const p of packs) {
            const count = Object.keys(p.replace || {}).length;
            sec.addButtons([{ label: `${p.name} (${count})`, value: p.id, accent: 'green' }], async id => {
                try {
                    const r = await applyPack(packs.find(x => x.id === id));
                    window.HWLibs.settings.set(STORE, 'pack', id);
                    panel.setValue(`${r.appliedCount} swapped`);
                    if (r.skipped.length) HW.log('skin-packs', 'skipped: ' + r.skipped.join('; '));
                } catch (e) {
                    panel.setValue('error');
                    HW.log('skin-packs', 'apply failed: ' + e.message);
                }
            });
        }
        panel.addButtons([{ label: 'Vanilla', value: 'reset', accent: 'red' }], () => {
            restore();
            window.HWLibs.settings.remove(STORE, 'pack');
            panel.setValue('vanilla');
        });
        panel.setValue(saved ? `saved: ${saved}` : 'vanilla');

        // Auto-apply saved pack once its textures are in the cache (they load
        // progressively; retry on tick until all mapped paths are loaded).
        let tries = 0;
        HW.onTick(() => {
            if (!saved || activeId === saved || tries > 600) return;
            tries++;
            const p = packs.find(x => x.id === saved);
            if (!p) return;
            const allLoaded = Object.keys(p.replace || {}).every(k => findTexBySuffix(k).length);
            if (allLoaded) {
                applyPack(p).then(r => {
                    panel.setValue(`${r.appliedCount} swapped`);
                    if (r.skipped.length) HW.log('skin-packs', 'skipped: ' + r.skipped.join('; '));
                }).catch(e => HW.log('skin-packs', 'boot apply failed: ' + e.message));
            }
        });
    });

    HW.log('skin-packs', `ready with ${packs.length} pack(s): ${packs.map(p => p.name).join(', ')}`);
})();

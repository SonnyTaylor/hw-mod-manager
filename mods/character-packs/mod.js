/**
 * Character Packs — native Happy Wheels custom characters.
 *
 * Loads packs synced by the mod host from mods/character-packs/packs/<id>/
 * (character.json: {name, base, sheet, icon} — same schema as Jimbob's Custom
 * Characters, so community packs drop in unchanged). Assets are served by the
 * host from ./js/hw-character-packs/ (webroot mirror, rebuilt each boot).
 *
 * v1 scope: in-level skinning — the character's sprites are rebuilt from the
 * pack sheet using the base character's atlas geometry. Headless: no in-game
 * panel — the saved pack auto-applies at boot and in every new level session.
 * Switch packs from the console:
 *   window.charPacks.list() / apply(id) / reset() / current()
 *
 * Requires: game. Settings: none (selection persisted via HWLibs.settings).
 */
(function () {
    'use strict';
    const HW = window.__HW__;
    const packs = window.__HW__.characterPacks || [];
    if (!packs.length) { HW.log('character-packs', 'no packs synced — add packs to mods/character-packs/packs/'); return; }

    HW.onDisable(() => { /* teardown: restore original textures if skinned */ unskin(); });

    const STORE = 'character-packs';
    let activePack = null;
    let replacements = null; // Map(frameName → Texture) for the active pack
    let baseAtlas = null;    // {byRectKey → frameName, frames, sx, sy}
    let appliedSprites = []; // [{sprite, original}] to restore on unskin/disable

    function assetRoot() {
        // Game assets live under assets-<hash>/... Find the root from any
        // texture URL currently loaded (PIXI utils TextureCache).
        try {
            const pixi = HW.require(99430);
            for (const t of Object.values(pixi.WpD.TextureCache)) {
                const u = (t && t.baseTexture && t.baseTexture.resource && (t.baseTexture.resource.url || t.baseTexture.resource.src)) || '';
                const m = /^(.*\/assets-[^/]+\/)/.exec(u);
                if (m) return m[1];
            }
        } catch (e) {}
        return null;
    }

    // Build frameName → Texture map for the pack (sheet scaled to atlas grid).
    async function buildPack(p) {
        const pixi = HW.require(99430);
        const root = assetRoot();
        if (!root) throw new Error('game assets not ready yet');
        const atlasResp = await fetch(`${root}animate/character${p.base}/character${p.base}.json`);
        if (!atlasResp.ok) throw new Error(`base atlas for character ${p.base} not found (${atlasResp.status})`);
        const atlas = await atlasResp.json();
        const sheetUrl = `./js/hw-character-packs/${p.id}/${p.sheet}`;
        const base = pixi.gPd.from(sheetUrl).baseTexture;
        if (!base.valid) await new Promise((res, rej) => { base.once('loaded', res); base.once('error', rej); });
        const sx = base.width / atlas.meta.size.w, sy = base.height / atlas.meta.size.h;
        if (Math.abs(sx - sy) > 0.005) throw new Error(`${p.name}: sheet aspect must match the base atlas`);
        const map = new Map();
        for (const [name, f] of Object.entries(atlas.frames)) {
            const r = f.frame;
            map.set(name, new pixi.gPd(base, {
                x: r.x * sx, y: r.y * sy, width: r.w * sx, height: r.h * sy,
            }));
        }
        // Map sprite textures → atlas frame names by matching frame rects.
        const byRect = new Map();
        for (const [name, f] of Object.entries(atlas.frames)) {
            const r = f.frame;
            byRect.set(`${r.x},${r.y},${r.w},${r.h}`, name);
        }
        baseAtlas = { byRect, sx, sy };
        replacements = map;
        return map;
    }

    function frameNameFor(tex) {
        const r = tex.frame;
        return baseAtlas.byRect.get(`${r.x},${r.y},${r.w},${r.h}`) || null;
    }

    function collectSprites(obj, out, seen, depth) {
        if (!obj || typeof obj !== 'object' || seen.has(obj) || depth > 6) return;
        seen.add(obj);
        if (obj.pixiSprite) { out.push(obj); return; }
        for (const k of Object.keys(obj)) {
            if (k.startsWith('_') || k === 'parent') continue;
            try { collectSprites(obj[k], out, seen, depth + 1); } catch (e) {}
        }
    }

    function skin() {
        if (!replacements) return 0;
        const ch = window.HWLibs.game.character();
        if (!ch) return 0;
        const wrappers = [];
        collectSprites(ch, wrappers, new Set(), 0);
        let n = 0;
        for (const w of wrappers) {
            const s = w.pixiSprite;
            const tex = s.texture;
            if (!tex || s.__hwPackApplied) continue;
            const name = frameNameFor(tex);
            const rep = name && replacements.get(name);
            if (!rep) continue;
            appliedSprites.push({ sprite: s, original: tex });
            s.texture = rep;
            s.__hwPackApplied = true;
            n++;
        }
        return n;
    }

    function unskin() {
        for (const { sprite, original } of appliedSprites) {
            try { sprite.texture = original; sprite.__hwPackApplied = false; } catch (e) {}
        }
        appliedSprites = [];
        activePack = null;
    }

    // Console API (replaces the old in-game panel — selection is a
    // set-and-forget action, not something that needs a menu on screen).
    window.charPacks = {
        list() { return packs.map(p => ({ id: p.id, name: p.name, base: p.base })); },
        current() { return activePack; },
        async apply(id) {
            const p = packs.find(x => x.id === id);
            if (!p) throw new Error('unknown pack: ' + id);
            unskin();
            window.HWLibs.settings.set(STORE, 'pack', id);
            await buildPack(p);
            activePack = id;
            const n = skin();
            HW.log('character-packs', `applied ${p.name} — ${n} sprites reskinned`);
            return n;
        },
        reset() {
            unskin();
            window.HWLibs.settings.remove(STORE, 'pack');
            HW.log('character-packs', 'reset to vanilla');
        }
    };

    HW.onReady(() => {
        const saved = window.HWLibs.settings.get(STORE, 'pack', null);
        // Re-apply the saved pack whenever a level session starts.
        let lastSession = null;
        HW.onTick(() => {
            const ch = window.HWLibs.game.character();
            if (!ch) { lastSession = null; return; }
            const sess = window.HWLibs.game.session();
            if (sess === lastSession || !replacements || activePack === null) { lastSession = sess; return; }
            lastSession = sess;
            const n = skin();
            if (n) HW.log('character-packs', `re-applied pack in new session — ${n} sprites`);
        });

        // If a pack was saved previously, rebuild + apply on boot (in level).
        if (saved) {
            const p = packs.find(x => x.id === saved);
            if (p) buildPack(p).then(() => { activePack = saved; skin(); }).catch(e => HW.log('character-packs', `boot apply failed: ${e.message}`));
        }
    });

    HW.log('character-packs', `ready with ${packs.length} pack(s): ${packs.map(p => p.name).join(', ')} — switch via window.charPacks`);
})();

/**
 * HWLibs.settings — namespaced localStorage for mods (never touches the game's
 * own option135 key). Values are JSON-serialized per namespace.
 *
 * Requires: nothing. Registers: window.HWLibs.settings
 *
 * Usage:
 *   HWLibs.settings.set('my-mod', 'volume', 0.5);
 *   HWLibs.settings.get('my-mod', 'volume', 0.8);   // → 0.5
 */
(function () {
    'use strict';

    const read = (ns) => {
        try { return JSON.parse(localStorage.getItem('hw.' + ns)) || {}; }
        catch (e) { return {}; }
    };
    const write = (ns, data) => {
        try { localStorage.setItem('hw.' + ns, JSON.stringify(data)); } catch (e) {}
    };

    window.HWLibs = window.HWLibs || {};
    window.HWLibs.settings = {
        get(ns, key, fallback) {
            const d = read(ns);
            return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : fallback;
        },
        set(ns, key, value) { const d = read(ns); d[key] = value; write(ns, d); return value; },
        remove(ns, key) { const d = read(ns); delete d[key]; write(ns, d); },
        clear(ns) { try { localStorage.removeItem('hw.' + ns); } catch (e) {} },
        all(ns) { return read(ns); }
    };
})();

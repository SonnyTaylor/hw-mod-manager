/**
 * HWLibs.ui — overlay panel factory for in-game mod UI.
 * Dark draggable panel with collapse/close, state persisted per storageKey.
 *
 * Requires: nothing. Registers: window.HWLibs.ui
 *
 * Usage:
 *   const panel = HWLibs.ui.panel({ title: 'Gravity', storageKey: 'gravity' });
 *   const slider = panel.addSlider({ label: 'Strength', min: 0, max: 3, step: 0.05, value: 1,
 *       onInput: v => gravity.set(v) });
 *   panel.addButtons([{ label: 'Earth', value: 1 }, ...], v => gravity.set(v));
 *   slider.set(0.5);   // update programmatically (skips onInput)
 */
(function () {
    'use strict';

    const CSS = [
        '.hw-panel{position:fixed;top:12px;right:12px;z-index:99999;width:230px;',
        'font:12px/1.4 system-ui,sans-serif;color:#eee;background:rgba(20,22,28,.85);',
        'border:1px solid #3a3f4a;border-radius:8px;user-select:none;box-shadow:0 4px 16px rgba(0,0,0,.5)}',
        '.hw-panel-head{display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:move;',
        'background:rgba(60,66,80,.6);border-radius:7px 7px 0 0;font-weight:600}',
        '.hw-panel-value{margin-left:auto;color:#8fc7ff;font-variant-numeric:tabular-nums}',
        '.hw-panel-head button{background:none;border:0;color:#99a;cursor:pointer;font-size:14px;padding:0 2px}',
        '.hw-panel-head button:hover{color:#fff}',
        '.hw-panel-body{padding:8px 10px 10px}',
        '.hw-panel.collapsed .hw-panel-body{display:none}',
        '.hw-panel.closed{display:none}',
        '.hw-slider{width:100%;accent-color:#4a9eff;cursor:pointer}',
        '.hw-buttons{display:flex;gap:4px;margin-top:7px;flex-wrap:wrap}',
        '.hw-buttons button{flex:1;background:#2a2f3a;color:#ccd;border:1px solid #3a3f4a;',
        'border-radius:4px;padding:3px 2px;font-size:10px;cursor:pointer}',
        '.hw-buttons button:hover{background:#3a4050;color:#fff}'
    ].join('\n');

    function ensureStyles() {
        if (document.getElementById('hw-libs-ui-style')) return;
        const s = document.createElement('style');
        s.id = 'hw-libs-ui-style';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    window.HWLibs = window.HWLibs || {};

    window.HWLibs.ui = {
        /**
         * Create a panel. Options: {title, valueLabel, width, storageKey, x, y}.
         * Returns {el, body, addSlider, addButtons, setValue, onClosed}.
         */
        panel(opts) {
            ensureStyles();
            const title = opts.title || 'Panel';
            let saved = {};
            if (opts.storageKey) {
                try { saved = JSON.parse(localStorage.getItem('hw.panel.' + opts.storageKey)) || {}; } catch (e) {}
            }

            const el = document.createElement('div');
            el.className = 'hw-panel';
            if (saved.width || opts.width) el.style.width = (saved.width || opts.width) + 'px';
            el.innerHTML =
                '<div class="hw-panel-head">' +
                '  <span class="hw-panel-title"></span>' +
                '  <span class="hw-panel-value"></span>' +
                '  <button class="hw-panel-min" title="Collapse">–</button>' +
                '  <button class="hw-panel-close" title="Close">×</button>' +
                '</div>' +
                '<div class="hw-panel-body"></div>';
            el.querySelector('.hw-panel-title').textContent = title;
            document.body.appendChild(el);

            if (saved.closed) el.classList.add('closed');
            if (saved.collapsed) el.classList.add('collapsed');
            if (saved.x != null) { el.style.left = saved.x + 'px'; el.style.right = 'auto'; el.style.top = saved.y + 'px'; }

            const valueEl = el.querySelector('.hw-panel-value');
            const body = el.querySelector('.hw-panel-body');
            const closeHandlers = [];
            const save = () => {
                if (!opts.storageKey) return;
                const r = el.getBoundingClientRect();
                try {
                    localStorage.setItem('hw.panel.' + opts.storageKey, JSON.stringify({
                        x: r.left, y: r.top,
                        width: r.width, collapsed: el.classList.contains('collapsed')
                    }));
                } catch (e) {}
            };

            el.querySelector('.hw-panel-close').addEventListener('click', () => {
                el.classList.add('closed');
                closeHandlers.forEach(f => { try { f(); } catch (e) {} });
                save();
            });
            el.querySelector('.hw-panel-min').addEventListener('click', () => {
                el.classList.toggle('collapsed'); save();
            });

            // dragging
            let drag = null;
            el.querySelector('.hw-panel-head').addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                const r = el.getBoundingClientRect();
                drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
                el.style.right = 'auto';
                e.preventDefault();
            });
            window.addEventListener('mousemove', (e) => {
                if (!drag) return;
                el.style.left = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - drag.dx)) + 'px';
                el.style.top = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - drag.dy)) + 'px';
            });
            window.addEventListener('mouseup', () => { if (drag) { drag = null; save(); } });

            const api = {
                el,
                body,
                /** Show a live value next to the title (e.g. "2.53x"). Pass '' to hide. */
                setValue(text) { valueEl.textContent = text || ''; },
                /** Slider row. Returns {set(value, fireInput)} — set() updates UI only. */
                addSlider(o) {
                    const input = document.createElement('input');
                    input.type = 'range';
                    input.className = 'hw-slider';
                    input.min = o.min; input.max = o.max; input.step = o.step; input.value = o.value;
                    input.addEventListener('input', () => o.onInput(parseFloat(input.value)));
                    body.appendChild(input);
                    return {
                        el: input,
                        set(v, fire) { input.value = v; if (fire) input.dispatchEvent(new Event('input')); }
                    };
                },
                /** Row of preset buttons; onClick receives item.value. */
                addButtons(items, onClick) {
                    const row = document.createElement('div');
                    row.className = 'hw-buttons';
                    items.forEach(it => {
                        const b = document.createElement('button');
                        b.textContent = it.label;
                        b.addEventListener('click', () => onClick(it.value, it));
                        row.appendChild(b);
                    });
                    body.appendChild(row);
                    return row;
                },
                /** Fired when the user closes the panel (e.g. stop pollers). */
                onClosed(fn) { closeHandlers.push(fn); },
                show() { el.classList.remove('closed'); }
            };
            return api;
        }
    };
})();

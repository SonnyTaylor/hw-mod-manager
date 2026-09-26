/**
 * HWLibs.ui — overlay panel factory for in-game mod UI. v2
 * Dark glass panel, draggable, collapsible; sections are collapsible groups
 * with per-section state persisted per storageKey.
 *
 * Requires: nothing. Registers: window.HWLibs.ui
 *
 * Usage:
 *   const panel = HWLibs.ui.panel({ title: 'Cheats', storageKey: 'cheats' });
 *
 *   const sec = panel.addSection('Gravity');   // collapsible group
 *   sec.addSlider({ label, min, max, step, value, onInput: v => {} });
 *   sec.addButtons([{ label, value, accent? }], v => {});   // accent: 'red'|'green'|'blue'
 *   sec.addToggle({ label, value, onChange: b => {} });
 *
 *   panel.addSlider/addButtons/addToggle  — same, but outside any section
 *   panel.setValue('text')                — chip next to the title
 *   panel.onClosed(fn)                    — panel's × clicked
 *
 *   slider.set(v, fireInput?) / toggle.set(checked) — update UI only
 */
(function () {
    'use strict';

    const CSS = [
        '@keyframes hw-in{from{opacity:0;transform:translateY(-6px) scale(.98)}}',
        '.hw-panel{position:fixed;top:12px;right:12px;z-index:99999;width:230px;',
        'font:12px/1.45 system-ui,-apple-system,sans-serif;color:#e8eaf0;',
        'background:linear-gradient(180deg,rgba(24,27,34,.92),rgba(15,17,23,.94));',
        'border:1px solid rgba(120,140,180,.25);border-radius:10px;',
        'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
        'box-shadow:0 8px 32px rgba(0,0,0,.55);user-select:none;',
        'animation:hw-in .18s ease-out}',

        '.hw-panel-head{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:move;',
        'background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02));',
        'border-bottom:1px solid rgba(120,140,180,.18);',
        'border-radius:9px 9px 0 0;font-weight:650;letter-spacing:.02em}',
        '.hw-panel-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.hw-panel-value{margin-left:auto;font-size:10.5px;color:#9fd0ff;white-space:nowrap;',
        'background:rgba(74,158,255,.12);border:1px solid rgba(74,158,255,.25);',
        'padding:2px 8px;border-radius:99px;font-variant-numeric:tabular-nums}',
        '.hw-panel-value:empty{display:none}',
        '.hw-panel-head button{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);',
        'color:#9aa3b5;cursor:pointer;font-size:11px;width:19px;height:19px;line-height:1;',
        'border-radius:5px;padding:0;flex:none;transition:all .12s}',
        '.hw-panel-head button:hover{color:#fff;background:rgba(255,255,255,.14)}',

        '.hw-panel-body{padding:10px;max-height:min(78vh,680px);overflow-y:auto;',
        'scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.3) transparent}',
        '.hw-panel-body::-webkit-scrollbar{width:9px}',
        '.hw-panel-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:99px}',
        '.hw-panel-body::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.4)}',
        '.hw-panel.collapsed .hw-panel-body{display:none}',
        '.hw-panel.closed{display:none}',

        '.hw-section{margin-bottom:11px}',
        '.hw-section:last-child{margin-bottom:0}',
        '.hw-section-head{display:flex;align-items:center;gap:5px;cursor:pointer;padding:2px 0;',
        'font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;',
        'color:#8fa3bf;transition:color .15s}',
        '.hw-section-head:hover{color:#cfe0f5}',
        '.hw-chevron{display:inline-block;font-size:9px;color:#5c6b80;transition:transform .15s}',
        '.hw-section.collapsed .hw-chevron{transform:rotate(-90deg)}',
        '.hw-section.collapsed .hw-section-body{display:none}',
        '.hw-section-body{padding:5px 0 1px}',

        '.hw-slider{-webkit-appearance:none;appearance:none;width:100%;height:4px;margin:9px 0 3px;',
        'background:rgba(255,255,255,.13);border-radius:99px;outline:none;cursor:pointer}',
        '.hw-slider::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;',
        'background:#4a9eff;box-shadow:0 0 0 3px rgba(74,158,255,.25);cursor:pointer;transition:box-shadow .12s}',
        '.hw-slider::-webkit-slider-thumb:hover{box-shadow:0 0 0 5px rgba(74,158,255,.3)}',
        '.hw-slider::-moz-range-thumb{width:13px;height:13px;border-radius:50%;border:0;',
        'background:#4a9eff;cursor:pointer}',

        '.hw-buttons{display:flex;gap:5px;margin-top:7px;flex-wrap:wrap}',
        '.hw-buttons button{flex:1;min-width:0;background:linear-gradient(180deg,#2e3442,#262b37);',
        'color:#cdd6e4;border:1px solid rgba(255,255,255,.09);border-radius:6px;',
        'padding:4px 4px;font-size:10.5px;font-weight:600;cursor:pointer;',
        'font-family:inherit;transition:all .12s}',
        '.hw-buttons button:hover{background:linear-gradient(180deg,#394153,#2d3342);',
        'border-color:rgba(74,158,255,.4);transform:translateY(-1px)}',
        '.hw-buttons button:active{transform:translateY(0)}',
        '.hw-buttons button.hw-red{color:#ff8a95;border-color:rgba(255,93,108,.35)}',
        '.hw-buttons button.hw-red:hover{background:rgba(255,93,108,.14);box-shadow:0 0 12px rgba(255,93,108,.25)}',
        '.hw-buttons button.hw-green{color:#8fe3a8;border-color:rgba(80,220,130,.3)}',
        '.hw-buttons button.hw-green:hover{background:rgba(80,220,130,.12);box-shadow:0 0 12px rgba(80,220,130,.22)}',
        '.hw-buttons button.hw-blue{color:#8fc7ff;border-color:rgba(74,158,255,.35)}',
        '.hw-buttons button.hw-blue:hover{background:rgba(74,158,255,.12);box-shadow:0 0 12px rgba(74,158,255,.25)}',

        '.hw-toggle{display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer;font-size:11.5px}',
        '.hw-toggle input{display:none}',
        '.hw-switch{position:relative;width:30px;height:16px;flex:none;border-radius:99px;',
        'background:rgba(255,255,255,.15);transition:background .15s}',
        '.hw-switch::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;',
        'border-radius:50%;background:#cdd3de;transition:transform .15s}',
        '.hw-toggle input:checked+.hw-switch{background:#4a9eff}',
        '.hw-toggle input:checked+.hw-switch::after{transform:translateX(14px);background:#fff}'
    ].join('\n');

    const ACCENTS = ['red', 'green', 'blue'];

    function ensureStyles() {
        if (document.getElementById('hw-libs-ui-style')) return;
        const s = document.createElement('style');
        s.id = 'hw-libs-ui-style';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    /** Control builders that append into `container`. */
    function makeControls(container) {
        return {
            /** Slider row. Returns {el, set(value, fireInput)} — set() updates UI only. */
            addSlider(o) {
                const input = document.createElement('input');
                input.type = 'range';
                input.className = 'hw-slider';
                input.min = o.min; input.max = o.max; input.step = o.step; input.value = o.value;
                input.addEventListener('input', () => o.onInput(parseFloat(input.value)));
                container.appendChild(input);
                return { el: input, set(v, fire) { input.value = v; if (fire) input.dispatchEvent(new Event('input')); } };
            },
            /** Row of preset buttons; onClick receives item.value. item.accent: 'red'|'green'|'blue'. */
            addButtons(items, onClick) {
                const row = document.createElement('div');
                row.className = 'hw-buttons';
                items.forEach(it => {
                    const b = document.createElement('button');
                    b.textContent = it.label;
                    if (it.accent && ACCENTS.includes(it.accent)) b.classList.add('hw-' + it.accent);
                    b.addEventListener('click', () => onClick(it.value, it));
                    row.appendChild(b);
                });
                container.appendChild(row);
                return row;
            },
            /** Switch row. Returns {el, set(checked)} — set() updates UI only. */
            addToggle(o) {
                const row = document.createElement('label');
                row.className = 'hw-toggle';
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.checked = !!o.value;
                box.addEventListener('change', () => o.onChange(box.checked));
                const knob = document.createElement('span');
                knob.className = 'hw-switch';
                const text = document.createElement('span');
                text.textContent = o.label;
                row.appendChild(box); row.appendChild(knob); row.appendChild(text);
                container.appendChild(row);
                return { el: row, set(v) { box.checked = !!v; } };
            }
        };
    }

    window.HWLibs = window.HWLibs || {};

    window.HWLibs.ui = {
        /**
         * Create a panel. Options: {title, width, storageKey, x, y}.
         * Returns {el, body, addSlider, addButtons, addToggle, addSection,
         *          setValue, onClosed, show}.
         */
        panel(opts) {
            ensureStyles();
            const title = opts.title || 'Panel';
            let saved = {};
            if (opts.storageKey) {
                try { saved = JSON.parse(localStorage.getItem('hw.panel.' + opts.storageKey)) || {}; } catch (e) {}
                saved.sections = saved.sections || {};
            }

            const el = document.createElement('div');
            el.className = 'hw-panel';
            // Per-mod teardown marker: mods remove ONLY their own panel
            // (querySelector(`[data-hw-panel="..."`)`), never other mods'.
            el.dataset.hwPanel = opts.storageKey || opts.title || 'panel';
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
                const sections = {};
                el.querySelectorAll('.hw-section').forEach(s => {
                    sections[s.dataset.label] = s.classList.contains('collapsed');
                });
                try {
                    localStorage.setItem('hw.panel.' + opts.storageKey, JSON.stringify({
                        x: r.left, y: r.top, width: r.width,
                        collapsed: el.classList.contains('collapsed'),
                        sections
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

            const rootControls = makeControls(body);

            const api = Object.assign({
                el,
                body,
                /** Show a live value chip next to the title. Pass '' to hide. */
                setValue(text) { valueEl.textContent = text || ''; },
                /** Collapsible section group. Returns a section-scoped control set. */
                addSection(label) {
                    const sec = document.createElement('div');
                    sec.className = 'hw-section';
                    sec.dataset.label = label;
                    const head = document.createElement('div');
                    head.className = 'hw-section-head';
                    head.innerHTML = '<span class="hw-chevron">▾</span><span></span>';
                    head.lastChild.textContent = label;
                    const secBody = document.createElement('div');
                    secBody.className = 'hw-section-body';
                    sec.appendChild(head); sec.appendChild(secBody);
                    body.appendChild(sec);

                    if (saved.sections[label]) sec.classList.add('collapsed');
                    head.addEventListener('click', () => { sec.classList.toggle('collapsed'); save(); });

                    const controls = makeControls(secBody);
                    return Object.assign({ el: sec, body: secBody }, controls);
                },
                /** Fired when the user closes the panel (e.g. stop pollers). */
                onClosed(fn) { closeHandlers.push(fn); },
                /** Remove the panel from the DOM (hot-disable teardown). */
                destroy() { el.remove(); },
                show() { el.classList.remove('closed'); }
            }, rootControls);
            return api;
        }
    };
})();

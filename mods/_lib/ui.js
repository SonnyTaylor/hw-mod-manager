/**
 * HWLibs.ui — overlay panel factory for in-game mod UI. v3
 * Dark glass panel with a hazard-amber accent. Panels auto-dock: new panels
 * without a user position arrange into a wrap-around row anchored top-right,
 * so mods never pile on top of each other. Dragging a panel "frees" it — it
 * keeps its position (persisted per storageKey) and the rest re-dock around it.
 *
 * Requires: nothing. Registers: window.HWLibs.ui
 *
 * Usage:
 *   const panel = HWLibs.ui.panel({ title: 'Cheats', storageKey: 'cheats' });
 *
 *   const sec = panel.addSection('Gravity');   // collapsible group
 *   sec.addSlider({ label, min, max, step, value, unit?, fmt?, onInput: v => {} });
 *   sec.addButtons([{ label, value, accent? }], v => {});   // accent: 'red'|'green'|'blue'
 *   sec.addToggle({ label, value, onChange: b => {} });
 *
 *   panel.addSlider/addButtons/addToggle  — same, but outside any section
 *   panel.setValue('text')                — chip next to the title
 *   panel.onClosed(fn)                    — panel's × clicked
 *
 *   slider.set(v, fireInput?) / toggle.set(checked) — update UI only
 *   (sliders also render their label + a live numeric readout above the track)
 */
(function () {
    'use strict';

    const CSS = [
        '@keyframes hw-in{from{opacity:0;transform:translateY(-4px) scale(.985)}}',

        // ---- panel shell ------------------------------------------------
        '.hw-panel{--acc:#ffb224;--acc-soft:rgba(255,178,36,.15);--acc-line:rgba(255,178,36,.4);',
        'position:fixed;top:12px;right:12px;z-index:99999;width:236px;',
        "font:12px/1.5 system-ui,'Segoe UI',Roboto,sans-serif;color:#e7eaf0;",
        'background:rgba(17,19,25,.93);border:1px solid rgba(255,255,255,.09);',
        'border-radius:11px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
        'box-shadow:0 12px 40px -8px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.4);',
        'user-select:none;-webkit-user-select:none;animation:hw-in .16s ease-out}',

        '.hw-panel-head{display:flex;align-items:center;gap:7px;padding:9px 8px 9px 12px;cursor:move;',
        'border-bottom:1px solid rgba(255,255,255,.07);border-radius:10px 10px 0 0}',
        '.hw-panel-title{display:flex;align-items:center;gap:8px;font-weight:700;font-size:12.5px;',
        'letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.hw-panel-title::before{content:"";width:8px;height:8px;flex:none;border-radius:2.5px;',
        'background:var(--acc);box-shadow:0 0 10px var(--acc-soft)}',
        '.hw-panel-value{margin-left:auto;font:600 10.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;',
        'color:var(--acc);white-space:nowrap;background:var(--acc-soft);',
        'border:1px solid var(--acc-line);padding:3px 8px;border-radius:99px;',
        'font-variant-numeric:tabular-nums}',
        '.hw-panel-value:empty{display:none}',
        '.hw-panel-head button{background:transparent;border:0;color:#7c8598;cursor:pointer;',
        'font-size:13px;width:20px;height:20px;line-height:20px;text-align:center;',
        'border-radius:5px;padding:0;flex:none;transition:all .12s;font-family:inherit}',
        '.hw-panel-head button:hover{color:#fff;background:rgba(255,255,255,.1)}',
        '.hw-panel-head button:focus-visible{outline:1px solid var(--acc-line)}',

        '.hw-panel-body{padding:4px 12px 12px;max-height:min(78vh,680px);overflow-y:auto;',
        'scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent}',
        '.hw-panel-body::-webkit-scrollbar{width:8px}',
        '.hw-panel-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.22);border-radius:99px}',
        '.hw-panel-body::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.38)}',
        '.hw-panel.collapsed .hw-panel-body{display:none}',
        '.hw-panel.closed{display:none}',

        // ---- sections ----------------------------------------------------
        '.hw-section{margin:11px 0 2px}',
        '.hw-section:first-child{margin-top:8px}',
        '.hw-section-head{display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 0;',
        'font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;',
        'color:#8b94a8;transition:color .15s}',
        '.hw-section-head:hover{color:#e7eaf0}',
        '.hw-section-head::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.08)}',
        '.hw-chevron{display:inline-block;font-size:9px;color:#5c6b80;transition:transform .15s}',
        '.hw-section.collapsed .hw-chevron{transform:rotate(-90deg)}',
        '.hw-section.collapsed .hw-section-body{display:none}',
        '.hw-section-body{padding:2px 0 4px}',

        // ---- sliders -------------------------------------------------------
        '.hw-slider-row{margin-top:8px}',
        '.hw-slider-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1px}',
        '.hw-slider-label{font-size:11px;font-weight:600;color:#aab3c5}',
        '.hw-slider-val{font:600 10.5px/1 ui-monospace,SFMono-Regular,Consolas,monospace;',
        'color:var(--acc);font-variant-numeric:tabular-nums}',
        '.hw-slider{-webkit-appearance:none;appearance:none;display:block;width:100%;height:4px;',
        'margin:7px 0 2px;border-radius:99px;outline:none;cursor:pointer;',
        'background:linear-gradient(90deg,var(--acc) var(--fill,0%),rgba(255,255,255,.14) var(--fill,0%))}',
        '.hw-slider::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;',
        'background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.55);cursor:pointer;transition:transform .12s}',
        '.hw-slider::-webkit-slider-thumb:hover{transform:scale(1.15)}',
        '.hw-slider:active::-webkit-slider-thumb{transform:scale(1.22)}',
        '.hw-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;border:0;background:#fff;',
        'box-shadow:0 1px 4px rgba(0,0,0,.55);cursor:pointer}',

        // ---- buttons -------------------------------------------------------
        '.hw-buttons{display:flex;gap:5px;margin-top:8px;flex-wrap:wrap}',
        '.hw-buttons button{flex:1 1 auto;min-width:0;background:rgba(255,255,255,.05);color:#c9d1e0;',
        'border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:5px 6px;',
        'font-size:10.5px;font-weight:600;line-height:1.25;font-family:inherit;cursor:pointer;',
        'transition:background .12s,border-color .12s,color .12s,transform .12s}',
        '.hw-buttons button:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.18);',
        'color:#fff;transform:translateY(-1px)}',
        '.hw-buttons button:active{transform:translateY(0)}',
        '.hw-buttons button:focus-visible{outline:1px solid var(--acc-line);outline-offset:1px}',
        '.hw-buttons button.hw-red{color:#ff8a95;border-color:rgba(255,93,108,.35)}',
        '.hw-buttons button.hw-red:hover{background:rgba(255,93,108,.16);border-color:rgba(255,93,108,.6);',
        'color:#ffb3ba;box-shadow:0 0 12px rgba(255,93,108,.25)}',
        '.hw-buttons button.hw-green{color:#8fe3a8;border-color:rgba(80,220,130,.3)}',
        '.hw-buttons button.hw-green:hover{background:rgba(80,220,130,.14);border-color:rgba(80,220,130,.55);',
        'color:#b8f0c9;box-shadow:0 0 12px rgba(80,220,130,.22)}',
        '.hw-buttons button.hw-blue{color:#8fc7ff;border-color:rgba(74,158,255,.35)}',
        '.hw-buttons button.hw-blue:hover{background:rgba(74,158,255,.14);border-color:rgba(74,158,255,.6);',
        'color:#b8ddff;box-shadow:0 0 12px rgba(74,158,255,.25)}',

        // ---- toggles -------------------------------------------------------
        '.hw-toggle{display:flex;align-items:center;gap:8px;margin-top:9px;cursor:pointer;',
        'font-size:11.5px;font-weight:500;color:#cfd6e4;transition:color .12s}',
        '.hw-toggle:hover{color:#fff}',
        '.hw-toggle input{display:none}',
        '.hw-switch{position:relative;margin-left:auto;width:30px;height:17px;flex:none;border-radius:99px;',
        'background:rgba(255,255,255,.16);transition:background .15s}',
        '.hw-switch::after{content:"";position:absolute;top:2.5px;left:2.5px;width:12px;height:12px;',
        'border-radius:50%;background:#aab2c2;transition:transform .15s,background .15s}',
        '.hw-toggle input:checked+.hw-switch{background:var(--acc);box-shadow:0 0 10px var(--acc-soft)}',
        '.hw-toggle input:checked+.hw-switch::after{transform:translateX(13px);background:#fff}'
    ].join('\n');

    const ACCENTS = ['red', 'green', 'blue'];
    const EDGE = 12;   // corner padding
    const GAP = 10;    // gap between docked panels

    function ensureStyles() {
        if (document.getElementById('hw-libs-ui-style')) return;
        const s = document.createElement('style');
        s.id = 'hw-libs-ui-style';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    // ------------------------------------------------------------------
    // Dock layout — panels without a user-set position auto-arrange into a
    // wrap-around row anchored at the top-right corner (masonry: rows grow
    // downward when the screen runs out of width). Free (dragged) panels and
    // closed panels are skipped; the rest close ranks on any change.
    // ------------------------------------------------------------------
    const dock = [];           // [{ el }]
    let relayoutQueued = false;

    function relayout() {
        let rowH = 0, top = EDGE, cursor = window.innerWidth - EDGE;
        for (const item of dock) {
            const el = item.el;
            if (!el.isConnected || el.classList.contains('closed')) continue;
            const w = el.offsetWidth, h = el.offsetHeight;
            if (rowH > 0 && cursor - w < EDGE) { top += rowH + GAP; rowH = 0; cursor = window.innerWidth - EDGE; }
            el.style.left = Math.max(EDGE, cursor - w) + 'px';
            el.style.top = top + 'px';
            el.style.right = 'auto';
            cursor -= w + GAP;
            rowH = Math.max(rowH, h);
        }
    }
    function requestRelayout() {
        if (relayoutQueued) return;
        relayoutQueued = true;
        requestAnimationFrame(() => { relayoutQueued = false; relayout(); });
    }
    window.addEventListener('resize', requestRelayout);

    function undock(el) {
        const i = dock.findIndex(d => d.el === el);
        if (i !== -1) { dock.splice(i, 1); requestRelayout(); }
    }

    /** Control builders that append into `container`. */
    function makeControls(container) {
        return {
            /** Slider row (label + live value above a filled track).
             *  Returns {el, set(value, fireInput)} — set() updates UI only. */
            addSlider(o) {
                const wrap = document.createElement('div');
                wrap.className = 'hw-slider-row';
                const head = document.createElement('div');
                head.className = 'hw-slider-head';
                const name = document.createElement('span');
                name.className = 'hw-slider-label';
                name.textContent = o.label || '';
                const val = document.createElement('span');
                val.className = 'hw-slider-val';
                head.appendChild(name); head.appendChild(val);
                wrap.appendChild(head);

                const input = document.createElement('input');
                input.type = 'range';
                input.className = 'hw-slider';
                input.min = o.min; input.max = o.max; input.step = o.step; input.value = o.value;
                const fmt = v => (o.fmt ? o.fmt(v) : String(+(+v).toFixed(2))) + (o.unit || '');
                const paint = () => {
                    const span = (o.max - o.min) || 1;
                    const pct = ((parseFloat(input.value) - o.min) / span) * 100;
                    input.style.setProperty('--fill', pct + '%');
                    val.textContent = fmt(parseFloat(input.value));
                };
                input.addEventListener('input', () => { paint(); o.onInput(parseFloat(input.value)); });
                wrap.appendChild(input);
                container.appendChild(wrap);
                paint();
                return { el: wrap, set(v, fire) { input.value = v; paint(); if (fire) input.dispatchEvent(new Event('input')); } };
            },
            /** Row of preset buttons; onClick receives item.value. item.accent: 'red'|'green'|'blue'. */
            addButtons(items, onClick) {
                const row = document.createElement('div');
                row.className = 'hw-buttons';
                items.forEach(it => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.textContent = it.label;
                    if (it.accent && ACCENTS.includes(it.accent)) b.classList.add('hw-' + it.accent);
                    b.addEventListener('click', () => onClick(it.value, it));
                    row.appendChild(b);
                });
                container.appendChild(row);
                return row;
            },
            /** Switch row (label left, switch right). Returns {el, set(checked)} — set() updates UI only. */
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
                row.appendChild(text); row.appendChild(box); row.appendChild(knob);
                container.appendChild(row);
                return { el: row, set(v) { box.checked = !!v; } };
            }
        };
    }

    window.HWLibs = window.HWLibs || {};

    window.HWLibs.ui = {
        /**
         * Create a panel. Options: {title, width, storageKey, x, y}.
         * x/y (or a previously dragged position) pin the panel; otherwise it
         * auto-docks at the top-right corner next to other panels.
         * Returns {el, body, addSlider, addButtons, addToggle, addSection,
         *          setValue, onClosed, show, destroy}.
         */
        panel(opts) {
            ensureStyles();
            const title = opts.title || 'Panel';
            let saved = {};
            if (opts.storageKey) {
                try { saved = JSON.parse(localStorage.getItem('hw.panel.' + opts.storageKey)) || {}; } catch (e) {}
            }
            saved.sections = saved.sections || {};

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
            if (saved.userX != null) {
                // Restore a user-dragged position, clamped into the viewport.
                const x = Math.min(saved.userX, window.innerWidth - 60);
                const y = Math.min(saved.userY, window.innerHeight - 30);
                el.style.left = Math.max(0, x) + 'px';
                el.style.top = Math.max(0, y) + 'px';
                el.style.right = 'auto';
            } else if (opts.x != null || opts.y != null) {
                el.style.left = (opts.x || 0) + 'px';
                el.style.top = (opts.y || 0) + 'px';
                el.style.right = 'auto';
            } else {
                dock.push({ el });
            }

            const valueEl = el.querySelector('.hw-panel-value');
            const body = el.querySelector('.hw-panel-body');
            const closeHandlers = [];
            let userPos = false;   // set once the user drags the panel

            const save = () => {
                if (!opts.storageKey) return;
                const r = el.getBoundingClientRect();
                const sections = {};
                el.querySelectorAll('.hw-section').forEach(s => {
                    sections[s.dataset.label] = s.classList.contains('collapsed');
                });
                const data = {
                    width: r.width,
                    collapsed: el.classList.contains('collapsed'),
                    sections
                };
                // Only persist position when the user placed it themselves —
                // docked panels keep auto-docking across sessions.
                if (userPos) { data.userX = r.left; data.userY = r.top; }
                try { localStorage.setItem('hw.panel.' + opts.storageKey, JSON.stringify(data)); } catch (e) {}
            };

            el.querySelector('.hw-panel-close').addEventListener('click', () => {
                el.classList.add('closed');
                closeHandlers.forEach(f => { try { f(); } catch (e) {} });
                save();
                requestRelayout();
            });
            el.querySelector('.hw-panel-min').addEventListener('click', () => {
                el.classList.toggle('collapsed'); save(); requestRelayout();
            });

            // dragging — first drag undocks the panel and freezes its spot
            let drag = null;
            el.querySelector('.hw-panel-head').addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                const r = el.getBoundingClientRect();
                drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
                el.style.right = 'auto';
                undock(el);
                userPos = true;
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
                    head.addEventListener('click', () => { sec.classList.toggle('collapsed'); save(); requestRelayout(); });

                    const controls = makeControls(secBody);
                    return Object.assign({ el: sec, body: secBody }, controls);
                },
                /** Fired when the user closes the panel (e.g. stop pollers). */
                onClosed(fn) { closeHandlers.push(fn); },
                /** Remove the panel from the DOM (hot-disable teardown). */
                destroy() { undock(el); el.remove(); },
                show() { el.classList.remove('closed'); requestRelayout(); }
            }, rootControls);

            requestRelayout();
            return api;
        }
    };
})();

/**
 * Gravity UI — on-screen slider for the Gravity Modifier mod.
 * Requires gravity-mod (window.gravity API).
 *
 * Draggable panel, top-right by default. Slider 0–3x, quick presets,
 * live readout. Collapse (−) / close (×). State persisted in localStorage
 * key `hw.gravityUI` (position, collapsed, closed).
 */
(function () {
    'use strict';

    const HW = window.__HW__;
    const LS_KEY = 'hw.gravityUI';

    HW.onReady(function () {
        if (!window.gravity) {
            HW.log('Gravity UI', 'gravity-mod not loaded — cannot start');
            return;
        }

        let state;
        try { state = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { state = {}; }

        // --- build panel -----------------------------------------------------
        const panel = document.createElement('div');
        panel.id = 'hw-gravity-panel';
        panel.innerHTML =
            '<div id="hw-gravity-head">' +
            '  <span id="hw-gravity-title">Gravity</span>' +
            '  <span id="hw-gravity-value">1.00x</span>' +
            '  <button id="hw-gravity-min" title="Collapse">–</button>' +
            '  <button id="hw-gravity-close" title="Close">×</button>' +
            '</div>' +
            '<div id="hw-gravity-body">' +
            '  <input id="hw-gravity-slider" type="range" min="0" max="3" step="0.05" value="1">' +
            '  <div id="hw-gravity-presets">' +
            '    <button data-g="0">0g</button>' +
            '    <button data-g="0.16">Moon</button>' +
            '    <button data-g="0.38">Mars</button>' +
            '    <button data-g="1">Earth</button>' +
            '    <button data-g="2.53">Jupiter</button>' +
            '  </div>' +
            '</div>';

        const style = document.createElement('style');
        style.textContent = [
            '#hw-gravity-panel{position:fixed;top:12px;right:12px;z-index:99999;width:230px;',
            'font:12px/1.4 system-ui,sans-serif;color:#eee;background:rgba(20,22,28,.85);',
            'border:1px solid #3a3f4a;border-radius:8px;user-select:none;box-shadow:0 4px 16px rgba(0,0,0,.5)}',
            '#hw-gravity-head{display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:move;',
            'background:rgba(60,66,80,.6);border-radius:7px 7px 0 0;font-weight:600}',
            '#hw-gravity-value{margin-left:auto;color:#8fc7ff;font-variant-numeric:tabular-nums}',
            '#hw-gravity-head button{background:none;border:0;color:#99a;cursor:pointer;font-size:14px;padding:0 2px}',
            '#hw-gravity-head button:hover{color:#fff}',
            '#hw-gravity-body{padding:8px 10px 10px}',
            '#hw-gravity-slider{width:100%;accent-color:#4a9eff;cursor:pointer}',
            '#hw-gravity-presets{display:flex;gap:4px;margin-top:7px;flex-wrap:wrap}',
            '#hw-gravity-presets button{flex:1;background:#2a2f3a;color:#ccd;border:1px solid #3a3f4a;',
            'border-radius:4px;padding:3px 2px;font-size:10px;cursor:pointer}',
            '#hw-gravity-presets button:hover{background:#3a4050;color:#fff}',
            '#hw-gravity-panel.collapsed #hw-gravity-body{display:none}',
            '#hw-gravity-panel.closed{display:none}'
        ].join('\n');
        document.head.appendChild(style);
        document.body.appendChild(panel);

        if (state.closed) panel.classList.add('closed');
        if (state.collapsed) panel.classList.add('collapsed');
        if (state.x != null) { panel.style.left = state.x + 'px'; panel.style.right = 'auto'; panel.style.top = state.y + 'px'; }

        const $ = (id) => panel.querySelector('#' + id);
        const slider = $('hw-gravity-slider');
        const value = $('hw-gravity-value');
        const save = () => {
            const r = panel.getBoundingClientRect();
            try { localStorage.setItem(LS_KEY, JSON.stringify({
                x: r.left, y: r.top, collapsed: panel.classList.contains('collapsed'), closed: panel.classList.contains('closed')
            })); } catch (e) {}
        };

        function apply(g) {
            const ok = window.gravity.set(g);
            if (ok) value.textContent = Number(g).toFixed(2) + 'x';
        }

        slider.addEventListener('input', () => apply(parseFloat(slider.value)));
        panel.querySelectorAll('#hw-gravity-presets button').forEach(b =>
            b.addEventListener('click', () => { const g = parseFloat(b.dataset.g); slider.value = g; apply(g); }));

        $('hw-gravity-close').addEventListener('click', () => { panel.classList.add('closed'); save(); });
        $('hw-gravity-min').addEventListener('click', () => { panel.classList.toggle('collapsed'); save(); });

        // --- dragging --------------------------------------------------------
        let drag = null;
        $('hw-gravity-head').addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            const r = panel.getBoundingClientRect();
            drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            panel.style.right = 'auto';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!drag) return;
            panel.style.left = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - drag.dx)) + 'px';
            panel.style.top = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - drag.dy)) + 'px';
        });
        window.addEventListener('mouseup', () => { if (drag) { drag = null; save(); } });

        // --- readout sync ----------------------------------------------------
        setInterval(() => {
            const g = window.gravity.get();
            if (g && document.activeElement !== slider) {
                slider.value = Math.max(0, Math.min(3, g.multiplier));
                value.textContent = g.multiplier.toFixed(2) + 'x';
            }
        }, 500);

        HW.log('Gravity UI', 'panel ready (top-right) — drag to move');
    });
})();

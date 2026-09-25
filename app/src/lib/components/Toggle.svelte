<script lang="ts">
  /**
   * The signature workshop switch — squared mechanical toggle, hazard orange when on.
   * Accessible: role=switch, keyboard operable.
   */
  let {
    checked = false,
    disabled = false,
    label = 'Toggle',
    onchange,
  }: {
    checked?: boolean;
    disabled?: boolean;
    label?: string;
    onchange?: (next: boolean) => void;
  } = $props();

  function flip() {
    if (disabled) return;
    onchange?.(!checked);
  }
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  class="hw-switch"
  class:on={checked}
  onclick={flip}
  onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); flip(); } }}
>
  <span class="knob"></span>
</button>

<style>
  .hw-switch {
    position: relative;
    width: 52px;
    height: 28px;
    border-radius: 6px;
    background: var(--color-bench-700);
    border: 1px solid var(--color-bench-600);
    box-shadow: inset 0 2px 4px rgb(0 0 0 / 0.45);
    cursor: pointer;
    padding: 0;
    transition: background 0.16s ease, border-color 0.16s ease;
    flex: none;
  }
  .hw-switch:hover { border-color: var(--color-bench-500); }
  .hw-switch:disabled { opacity: 0.45; cursor: not-allowed; }
  .hw-switch:focus-visible { outline: 2px solid var(--color-hazard); outline-offset: 2px; }
  .hw-switch.on {
    background: var(--color-hazard);
    border-color: var(--color-hazard);
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: linear-gradient(180deg, #cfd4de 0%, #a7adb9 100%);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.5);
    transition: transform 0.16s ease;
  }
  .hw-switch.on .knob {
    transform: translateX(24px);
    background: linear-gradient(180deg, #fff 0%, #dcdfe6 100%);
  }
  /* grip lines on the knob — the one decorative flourish */
  .knob::after {
    content: '';
    position: absolute;
    inset: 9px 4px;
    background:
      linear-gradient(180deg, transparent 0, transparent 1px, rgb(0 0 0 / 0.28) 1px, rgb(0 0 0 / 0.28) 2px, transparent 2px, transparent 4px, rgb(0 0 0 / 0.28) 4px, rgb(0 0 0 / 0.28) 5px, transparent 5px);
  }
</style>

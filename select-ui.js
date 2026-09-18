'use strict';

// Keep the native fields as the form's source of truth. This layer only renders
// their current state and commits a value after an explicit user selection.
(() => {
  const controls = new Map();
  let nextId = 0;
  let openControl = null;
  const gap = 6;
  const edge = 8;

  function enhance(select) {
    if (controls.has(select) || select.multiple || select.size > 1) return;
    const id = `warmup-select-${++nextId}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'select-control';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = `${id}-trigger`;
    trigger.className = 'select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${id}-listbox`);
    const value = document.createElement('span');
    value.className = 'select-value';
    const chevron = document.createElement('span');
    chevron.className = 'select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(value, chevron);
    const menu = document.createElement('div');
    menu.className = 'select-menu';
    menu.id = `${id}-listbox`;
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    select.before(wrapper);
    wrapper.append(select, trigger);
    document.body.append(menu);
    select.classList.add('select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    let rows = [];
    let signature = '';
    let selectedOption = null;
    let activeOption = null;
    let search = '';
    let searchedAt = 0;
    const labels = [...select.labels];
    const isDisabled = () => select.matches(':disabled');
    const optionDisabled = option => option.disabled || Boolean(option.closest('optgroup')?.disabled);
    const optionHidden = option => option.hidden || Boolean(option.closest('optgroup')?.hidden);
    const enabledRows = () => rows.filter(row => !optionDisabled(row.option));
    const control = { sync, close, position };
    controls.set(select, control);

    function setActive(option, scroll = true) {
      activeOption = option;
      for (const row of rows) row.node.classList.toggle('is-active', row.option === option);
      const active = rows.find(row => row.option === option);
      if (!menu.hidden && active) {
        trigger.setAttribute('aria-activedescendant', active.node.id);
        if (scroll) active.node.scrollIntoView?.({ block: 'nearest' });
      } else trigger.removeAttribute('aria-activedescendant');
    }

    function close() {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      search = '';
      if (openControl === control) openControl = null;
    }

    function position() {
      if (menu.hidden) return;
      const bounds = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.max(0, Math.min(bounds.width, viewportWidth - edge * 2));
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.max(edge, Math.min(bounds.left, viewportWidth - edge - width))}px`;
      const below = Math.max(0, viewportHeight - bounds.bottom - gap - edge);
      const above = Math.max(0, bounds.top - gap - edge);
      // scrollHeight excludes borders, while the menu's max-height uses border-box.
      const borderHeight = menu.offsetHeight - menu.clientHeight;
      const desired = Math.min((menu.scrollHeight || rows.length * 36 + 10) + borderHeight, 280);
      const useBelow = below >= desired || below >= above;
      const height = Math.min(desired, useBelow ? below : above);
      menu.style.maxHeight = `${height}px`;
      menu.style.top = `${Math.max(edge, useBelow ? bounds.bottom + gap : bounds.top - gap - height)}px`;
      menu.dataset.placement = useBelow ? 'bottom' : 'top';
    }

    function open() {
      sync();
      if (isDisabled() || !rows.length) return;
      if (openControl && openControl !== control) openControl.close();
      openControl = control;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      position();
      const selected = rows.find(row => row.option.selected && !optionDisabled(row.option));
      setActive(selected?.option || enabledRows()[0]?.option || null);
    }

    function commit(option) {
      // Options can be replaced by tab discovery while a picker is open. A stale
      // row must never choose the different account now occupying its old index.
      const index = [...select.options].indexOf(option);
      if (isDisabled() || index < 0 || optionDisabled(option) || optionHidden(option)) {
        close(); sync(); return;
      }
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      close();
      sync();
      if (changed) {
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
      }
    }

    function sync() {
      trigger.disabled = isDisabled();
      trigger.setAttribute('aria-disabled', String(trigger.disabled));
      trigger.setAttribute('aria-required', String(select.required));
      for (const attribute of ['aria-describedby', 'aria-invalid']) {
        if (select.hasAttribute(attribute)) trigger.setAttribute(attribute, select.getAttribute(attribute));
        else if (attribute !== 'aria-invalid' || select.validity.valid) trigger.removeAttribute(attribute);
      }
      const labelIds = labels.map((label, index) => {
        if (!label.id) label.id = `${id}-label-${index}`;
        return label.id;
      });
      const labelledBy = select.getAttribute('aria-labelledby') || labelIds.join(' ');
      if (labelledBy) {
        trigger.setAttribute('aria-labelledby', labelledBy);
        menu.setAttribute('aria-labelledby', labelledBy);
        trigger.removeAttribute('aria-label');
      } else {
        const label = select.getAttribute('aria-label') || select.title || select.name || 'choose an option';
        trigger.setAttribute('aria-label', label);
        menu.setAttribute('aria-label', label);
      }
      const options = [...select.options];
      const selected = options[select.selectedIndex] || null;
      value.textContent = selected?.label || '';
      trigger.title = value.textContent;
      const nextSignature = JSON.stringify(options.map(option => [option.label, option.value, optionDisabled(option), optionHidden(option)]));
      // Keep the rows stable during ordinary state polling and keyboard browsing.
      if (signature !== nextSignature || rows.some(row => !options.includes(row.option))) {
        signature = nextSignature;
        rows = options.flatMap((option, index) => {
          if (optionHidden(option)) return [];
          const node = document.createElement('div');
          node.className = 'select-option';
          node.id = `${id}-option-${index}`;
          node.setAttribute('role', 'option');
          node.setAttribute('aria-disabled', String(optionDisabled(option)));
          const label = document.createElement('span');
          label.className = 'select-option-label';
          label.textContent = option.label;
          const check = document.createElement('span');
          check.className = 'select-option-check';
          check.textContent = '✓';
          check.setAttribute('aria-hidden', 'true');
          node.append(label, check);
          node.addEventListener('pointerdown', event => event.preventDefault());
          node.addEventListener('pointermove', () => { if (!optionDisabled(option)) setActive(option, false); });
          node.addEventListener('click', () => commit(option));
          return [{ option, node }];
        });
        menu.replaceChildren(...rows.map(row => row.node));
      }
      for (const row of rows) row.node.setAttribute('aria-selected', String(row.option === selected));
      if (selectedOption !== selected || !rows.some(row => row.option === activeOption && !optionDisabled(row.option))) {
        activeOption = rows.find(row => row.option === selected && !optionDisabled(row.option))?.option || enabledRows()[0]?.option || null;
      }
      selectedOption = selected;
      if (trigger.disabled || !rows.length) close();
      setActive(activeOption, false);
      position();
    }

    trigger.addEventListener('click', () => { if (menu.hidden) open(); else close(); });
    trigger.addEventListener('keydown', event => {
      if (isDisabled() || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key;
      if (key === 'Escape') {
        if (!menu.hidden) { event.preventDefault(); close(); }
        return;
      }
      if (key === 'Tab') {
        if (!menu.hidden && activeOption) commit(activeOption);
        else close();
        return;
      }
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        if (menu.hidden) open(); else if (activeOption) commit(activeOption);
        return;
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
        event.preventDefault();
        const wasClosed = menu.hidden;
        if (wasClosed) open();
        const enabled = enabledRows();
        if (!enabled.length) return;
        const current = enabled.findIndex(row => row.option === activeOption);
        let next = Math.max(0, current);
        if (key === 'Home') next = 0;
        else if (key === 'End') next = enabled.length - 1;
        else if (!wasClosed) next = Math.max(0, Math.min(enabled.length - 1, current + (key === 'ArrowDown' ? 1 : -1)));
        setActive(enabled[next].option);
        return;
      }
      if (key.length === 1 && key.trim()) {
        event.preventDefault();
        if (menu.hidden) open();
        const now = Date.now();
        search = now - searchedAt > 700 ? key : search + key;
        searchedAt = now;
        const repeated = [...search].every(character => character.toLowerCase() === key.toLowerCase());
        const query = (repeated ? key : search).toLocaleLowerCase();
        const enabled = enabledRows();
        const current = enabled.findIndex(row => row.option === activeOption);
        const start = repeated ? current + 1 : Math.max(0, current);
        const ordered = [...enabled.slice(start), ...enabled.slice(0, start)];
        const match = ordered.find(row => row.option.label.trim().toLocaleLowerCase().startsWith(query));
        if (match) setActive(match.option);
      }
    });
    trigger.addEventListener('blur', close);
    select.addEventListener('change', sync);
    select.addEventListener('input', sync);
    select.addEventListener('invalid', event => {
      event.preventDefault();
      trigger.setAttribute('aria-invalid', 'true');
      trigger.focus();
    });
    select.form?.addEventListener('reset', () => queueMicrotask(sync));
    for (const label of labels) label.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      event.preventDefault();
      trigger.focus();
    });
    const observer = new MutationObserver(sync);
    observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'label', 'value', 'selected', 'required', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-invalid'] });
    for (let ancestor = select.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === 'FIELDSET') observer.observe(ancestor, { attributes: true, attributeFilter: ['disabled'] });
    }
    sync();
  }

  function sync() {
    for (const select of document.querySelectorAll('select')) enhance(select);
    for (const [select, control] of controls) {
      if (select.isConnected) control.sync();
    }
  }
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.select-control, .select-menu')) openControl?.close();
  });
  document.addEventListener('scroll', () => openControl?.position(), true);
  window.addEventListener('resize', () => openControl?.position());
  window.warmupSelects = Object.freeze({ sync });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
  else sync();
})();

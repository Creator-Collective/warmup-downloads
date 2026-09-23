(() => {
  'use strict';
  const actions = ['like', 'follow', 'comment'];
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

  function render(document, state, prefix = 'stat-') {
    document.getElementById(`${prefix}scroll`).textContent = String(count(state.stats?.scroll));
    const notes = [];
    for (const action of actions) {
      const confirmed = count(state.stats?.[action]);
      const target = state.settings?.limits?.[action];
      const counter = document.getElementById(`${prefix}${action}`);
      const hasTarget = Number.isSafeInteger(target) && target >= 0;
      counter.textContent = hasTarget ? `${confirmed} / ${target}` : String(confirmed);
      counter.title = hasTarget ? `${confirmed} confirmed of ${target} ${action} target` : `${confirmed} confirmed`;
      const unconfirmed = count(state.unconfirmed?.[action]);
      if (unconfirmed) notes.push(`${unconfirmed} ${action}${unconfirmed === 1 ? '' : 's'} not confirmed`);
    }
    if (state.pausedActions?.includes('comment')) notes.push('comments paused to be safe. check the comment box in your platform tab');
    if (state.phase === 'complete' && actions.some(action => Number.isSafeInteger(state.settings?.limits?.[action]) && count(state.stats?.[action]) < state.settings.limits[action])) {
      notes.push('targets are upper limits. pacing and matching posts come first');
    }
    const note = document.getElementById('session-results-note');
    note.textContent = notes.length ? `${notes.join('. ')}.` : '';
    note.hidden = !notes.length;
    const heading = document.getElementById('activity-heading');
    const platform = ['instagram', 'tiktok'].includes(state.settings?.platform) ? state.settings.platform : '';
    const finished = ['complete', 'stopped', 'error'].includes(state.phase);
    heading.textContent = platform ? `${platform} ${finished ? 'results' : 'session'}` : 'session activity';
  }

  globalThis.sessionResults = { render };
  if (typeof module !== 'undefined') module.exports = globalThis.sessionResults;
})();

'use strict';
// Shared by the local panel and trusted session validation.
const paces = Object.freeze({
  auto: { label: 'auto', scale: 1, description: 'mostly 3–7 second viewing pauses, with an occasional full video watch when it fits. 2–4 seconds between grid scrolls. short 15–25 second breaks about every 6–9 minutes. rotates keywords in order.' },
  relaxed: { label: 'relaxed', scale: 1.5, description: 'mostly 5–11 second viewing pauses, with an occasional full video watch when it fits. 3–6 seconds between grid scrolls. occasional 23–38 second breaks. rotates keywords in order.' },
  slow: { label: 'slow', scale: 2, description: 'mostly 6–14 second viewing pauses, with an occasional full video watch when it fits. 4–8 seconds between grid scrolls. occasional 30–50 second breaks. rotates keywords in order.' }
});
function validateSettings(input) {
  if (!input || typeof input !== 'object') throw new Error('choose your session settings first.');
  const integer = (value, min, max, label) => {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
    return value;
  };
  const minutes = integer(input.minutes, 1, 120, 'minutes');
  if (typeof input.niche !== 'string' || input.niche.length > 300) throw new Error('add up to 300 characters of niche search terms.');
  const unique = new Map();
  for (const term of input.niche.split(/[,\n]/).map(term => term.trim()).filter(Boolean)) unique.set(term.toLocaleLowerCase(), term);
  const terms = [...unique.values()];
  if (!terms.length || terms.length > 8 || terms.some(term => term.length > 60)) throw new Error('add 1–8 niche terms, separated by commas or new lines (up to 60 characters each).');
  const pace = input.pace ?? 'auto';
  if (!Object.hasOwn(paces, pace)) throw new Error('choose auto, relaxed, or slow pacing.');
  const activeMinutes = minutes / paces[pace].scale;
  const limits = {
    like: Math.min(60, Math.ceil(activeMinutes)),
    follow: Math.min(12, Math.floor(activeMinutes / 5)),
    comment: input.enableComments === true ? Math.min(6, Math.floor(activeMinutes / 10)) : 0
  };
  const weights = { like: 2, follow: 1, comment: 1 };
  for (const action of Object.keys(weights)) {
    if (input.mix != null) {
      if (typeof input.mix !== 'object' || Array.isArray(input.mix)) throw new Error('choose an engagement mix.');
      if (input.mix[action] !== undefined) weights[action] = integer(input.mix[action], 0, 10, `${action} share`);
    }
    if (input.customLimits != null) {
      if (typeof input.customLimits !== 'object' || Array.isArray(input.customLimits)) throw new Error('choose valid session limits.');
      if (input.customLimits[action] !== undefined) limits[action] = integer(input.customLimits[action], 0, { like: 60, follow: 12, comment: 6 }[action], `${action} limit`);
    }
    if (!weights[action] || (action === 'comment' && input.enableComments !== true)) limits[action] = 0;
    if (limits[action] === 0) weights[action] = 0;
  }
  return { minutes, terms, limits, weights, pace, pauseScale: paces[pace].scale };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { validateSettings, paces };
else globalThis.sessionPlan = { validateSettings, paces };

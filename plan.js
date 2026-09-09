'use strict';
// Shared by the local panel and trusted session validation.
const paces = Object.freeze({
  auto: { label: 'auto', scale: 1, description: 'mostly 8-18 second video watches, with regular full-video watches when they fit. short result-grid pauses. short 20-45 second breaks about every 5-9 minutes. rotates keywords in order.' },
  relaxed: { label: 'relaxed', scale: 1.5, description: 'mostly 12-27 second video watches, with regular full-video watches when they fit. 5-11 seconds between grid scrolls. occasional 30-68 second breaks. rotates keywords in order.' },
  slow: { label: 'slow', scale: 2, description: 'mostly 16-36 second video watches, with regular full-video watches when they fit. 6-14 seconds between grid scrolls. occasional 40-90 second breaks. rotates keywords in order.' }
});
function validateSettings(input) {
  if (!input || typeof input !== 'object') throw new Error('choose your session settings first.');
  const platform = input.platform == null || input.platform === '' ? 'instagram' : input.platform;
  if (!['instagram', 'tiktok'].includes(platform)) throw new Error('choose instagram or tiktok.');
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
    like: Math.min(120, Math.ceil(activeMinutes * 2)),
    follow: Math.min(45, Math.ceil(activeMinutes * .75)),
    comment: platform === 'tiktok' ? 0 : input.enableComments === true ? Math.min(20, Math.ceil(activeMinutes / 4)) : 0
  };
  const weights = { like: 2, follow: 1, comment: 1 };
  for (const action of Object.keys(weights)) {
    if (input.mix != null) {
      if (typeof input.mix !== 'object' || Array.isArray(input.mix)) throw new Error('choose an engagement mix.');
      if (input.mix[action] !== undefined) weights[action] = integer(input.mix[action], 0, 10, `${action} share`);
    }
    if (input.customLimits != null) {
      if (typeof input.customLimits !== 'object' || Array.isArray(input.customLimits)) throw new Error('choose valid session limits.');
      if (input.customLimits[action] !== undefined) limits[action] = integer(input.customLimits[action], 0, { like: 120, follow: 45, comment: 20 }[action], `${action} limit`);
    }
    if (platform === 'tiktok' && action === 'comment' && limits[action] > 0) throw new Error('tiktok comments are not supported yet.');
    if (!weights[action] || (action === 'comment' && input.enableComments !== true)) limits[action] = 0;
    if (limits[action] === 0) weights[action] = 0;
  }
  return { platform, minutes, terms, limits, weights, pace, pauseScale: paces[pace].scale };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { validateSettings, paces };
else globalThis.sessionPlan = { validateSettings, paces };

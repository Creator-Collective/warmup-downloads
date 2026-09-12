import { readFileSync } from 'node:fs';
import path from 'node:path';

export function releaseMetadata(root, version) {
  if (typeof version !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version)) throw new Error('invalid extension release version');
  const notes = JSON.parse(readFileSync(path.join(root, 'release-notes', `${version}.json`), 'utf8'));
  const date = typeof notes?.releasedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(notes.releasedAt) ? Date.parse(`${notes.releasedAt}T00:00:00.000Z`) : NaN;
  const validText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 400;
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== notes.releasedAt || !validText(notes.summary) || !Array.isArray(notes.changes) || notes.changes.length < 1 || notes.changes.length > 12 || !notes.changes.every(validText)) {
    throw new Error('invalid versioned release notes');
  }
  const origin = 'https://creator-collective-warmup.vercel.app';
  return {
    version,
    releasedAt: notes.releasedAt,
    summary: notes.summary,
    changes: notes.changes,
    downloadUrl: `${origin}/creator-collective-extension-${version}.zip`,
    appUrl: `${origin}/`,
    setupUrl: `${origin}/setup.html`
  };
}

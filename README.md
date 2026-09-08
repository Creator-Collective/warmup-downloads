# Creator Collective Warm-up

Website: https://creator-collective-warmup.vercel.app/

The current product is a Chrome side panel plus a public web dashboard. Clicking the extension icon opens the packaged panel. Panel requests use an exact extension-origin sender check; web requests keep their existing origin bridge. The dashboard configures one user-started session against one explicitly selected Instagram tab. A dedicated extension tab owns the timer and displays activity; panel starts leave this tab inactive. Closing the panel keeps the session alive; closing it stops the session. The web dashboard does not handle Instagram cookies or credentials.

## Current release status

0.5.0 is an early-access browser extension. The website provides the ZIP and manual Chrome setup instructions. It has not been submitted to or approved by the Chrome Web Store. 86 automated checks pass, including signup, authorization, cancellation, planner and dashboard regressions. Version 0.3.1 passed one live browsing-only test. Version 0.4.2 side-panel installation and integrated next-post behavior still require a manual extension reload and live verification. The native Instagram search-result modal and Next button were verified through read-only browsing. Engagement remains unverified. Automated access to Chrome extension setup is blocked by the browser tool security policy; installation must be completed manually. Older 0.2.1 desktop binaries remain available in the GitHub release history, but the website no longer recommends the blocked Mac downloads.

## Development

`npm run check` runs extension authorization, cancellation, persistence and runner regression tests using Node's built-in test runner. `npm run package:extension` creates both a beta ZIP containing the extension folder and a root-layout ZIP for store submission. The packaging allowlist intentionally excludes environment files, browser profiles, tests and repository metadata.

The Instagram observer and session planner began from the desktop implementation. They are bundled locally in the extension and require no remote executable code. Keep desktop and browser pacing changes synchronized deliberately; browser-specific cancellation and navigation are handled by runner.js and background.js.

## Deployment

This repository is linked to the existing creator-collective-warmup Vercel project. `.vercelignore` explicitly whitelists public web assets and the beta ZIP. Never upload `.env.local` or `.vercel` metadata. After changes, run checks, regenerate the ZIP, and deploy the validated files. The content-script bridge intentionally accepts only the exact production hostname; localhost and preview deployments show an unconnected dashboard.

## Client website integration

Link a “warm-up” tool entry from the client dashboard to https://creator-collective-warmup.vercel.app/. No Instagram login is collected on the website. Once the store listing is approved, replace manual setup with the verified Chrome Web Store installation URL. Do not invent a listing URL or mark the beta as approved.

## Store submission

See store/SUBMISSION.md for listing copy, permission justifications and privacy disclosures. The account owner must complete registration, any payment and policy attestations. Store screenshots must reflect actual verified product states.

## 0.4.2 browsing update

Auto viewing pauses are now 3–7 seconds, grid browsing pauses 2–4 seconds, and viewer reads no longer add a second pause. Post-engagement viewer pauses are short transitions, while existing action cooldowns and limits remain intact. Breaks last 15–25 seconds before pace scaling and are scheduled every 6–9 minutes. Multiple terms rotate in entered order at a duration-dependent interval capped at two minutes; a pending rotation bounds the current pause. Search/Instagram loading can add time. 57 automated checks pass; live installed 0.4.2 behavior has not been verified.

## 0.4.2 occasional longer viewing

Most viewer pauses remain short. A 15% opportunity selects a remaining-duration watch only for one visible playing video with known duration up to120seconds, valid progress/rate, and sufficient session/keyword time. Full watches cannot be consecutive. Duration is based on observed playback progress and rate, not multiplied by pacing; buffering can affect actual completion. Unknown metadata and videos that do not fit retain short pauses. 57 automated tests pass; integrated live0.4.2 verification remains pending.

## 0.5.0 account signup helper

The existing warm-up side panel now connects a selected signed-in student dashboard tab to Instagram or TikTok signup. It lists unused account emails, generates one if needed, fills recognised signup fields, retrieves a fresh platform-matching email code on request, and saves the actual username only after the student explicitly confirms signup finished. Students submit platform forms and handle birthday, phone and CAPTCHA checks. Warm-up remains Instagram-only. Unknown or changed forms pause; signup form selectors have not yet been verified in a signed-out live browser.

The public warm-up website does not collect signup credentials. Passwords stay in extension session storage for the active signup and are cleared when it ends. Auth stays in the selected student dashboard tab. Only the exact packaged side panel can use signup commands. Backend writes are bound to the profile selected when connecting.

This feature branch preserves the previous session’s uncommitted 0.4.2 source. Its canonical source checkout was left unchanged. Student API source is on `codex/warmup-signup-bridge-20260908` in `/Users/oliversung/Developer/cc-worktrees/warmup-signup-bridge-20260908`; no schema changes are required. Release the student `/api/account-setup` endpoint before distributing the extension. Publication was authorized on September 8, 2026. Both repositories use their existing feature-branch and PR release flow.

Remaining release checks: release both changes through their existing repositories/projects, reload the extension and accept the added TikTok/student-dashboard permissions, verify signed-in dashboard requests in real Chrome, then perform a user-supervised signup for each platform. Use the existing warm-up Vercel project; do not create a new hosting project.

Verification for this release: 86 extension/UI tests and 72 student bridge tests pass. Focused TypeScript compilation passes. Code, JavaScript/TypeScript and security reviews are complete, including delayed-stop/tab-close and code-recipient regressions. This does not replace the live Chrome/signup checks listed here.

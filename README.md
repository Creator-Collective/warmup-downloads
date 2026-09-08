# Creator Collective Warm-up

Website: https://creator-collective-warmup.vercel.app/

The current product is a Chrome side panel plus a public web dashboard. Clicking the extension icon opens the packaged panel. Panel requests use an exact extension-origin sender check; web requests keep their existing origin bridge. The dashboard configures one user-started session against one explicitly selected Instagram tab. A dedicated extension tab owns the timer and displays activity; panel starts leave this tab inactive. Closing the panel keeps the session alive; closing it stops the session. The web dashboard does not handle Instagram cookies or credentials.

## Current release status

0.6.1 keeps native account creation in the Chrome side panel: platform, username, password, start. No student dashboard tab or login is needed. The extension prepares its own private account email and submits recognized signup steps once, including fresh email verification. If Instagram is already signed in to another account, continue opens a private signup window so the current login stays untouched. Birthday, phone, CAPTCHA, unavailable names, and unclear forms pause for the user. Completion requires matching signed-in profile navigation after a details submission; a home redirect alone never counts. Warm-up remains Instagram-only and is started separately.

The website provides a ZIP and manual Chrome setup instructions. This beta has not been submitted to or approved by the Chrome Web Store. Automated fixtures cover the signup flow, cancellation, ownership, and existing warm-up behavior. Live account creation still needs verification on each platform after this package is reloaded. Do not describe fixture results as successful live signups.

Passwords remain in temporary extension session storage. A generated 256-bit install capability and signup email history remain in extension-local storage for mailbox recovery; neither passwords nor the capability are shown to the public website. Update the existing unpacked folder and reload its Chrome card to preserve those records. New folders or removing the extension do not transfer local mailbox access.

The email service is the separate native endpoint on the existing student backend; it does not read other student aliases. Deploy that backend and configure its server-only secret and explicit established team owner before distributing this extension. The existing authenticated dashboard endpoint remains unchanged. No database migration is included.

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

## Archived 0.5.0 account signup helper

The existing warm-up side panel now connects a selected signed-in student dashboard tab to Instagram or TikTok signup. It lists unused account emails, generates one if needed, fills recognised signup fields, retrieves a fresh platform-matching email code on request, and saves the actual username only after the student explicitly confirms signup finished. Students submit platform forms and handle birthday, phone and CAPTCHA checks. Warm-up remains Instagram-only. Unknown or changed forms pause; signup form selectors have not yet been verified in a signed-out live browser.

The public warm-up website does not collect signup credentials. Passwords stay in extension session storage for the active signup and are cleared when it ends. Auth stays in the selected student dashboard tab. Only the exact packaged side panel can use signup commands. Backend writes are bound to the profile selected when connecting.

This feature branch preserves the previous session’s uncommitted 0.4.2 source. Its canonical source checkout was left unchanged. Student API source is on `codex/warmup-signup-bridge-20260908` in `/Users/oliversung/Developer/cc-worktrees/warmup-signup-bridge-20260908`; no schema changes are required. Release the student `/api/account-setup` endpoint before distributing the extension. Publication was authorized on September 8, 2026. Both repositories use their existing feature-branch and PR release flow.

0.6.0 supersedes the dashboard connection described in this archived section. Its remaining live check is a user-supervised signup on each platform after the extension is reloaded. Automated results are recorded in work_log.txt.

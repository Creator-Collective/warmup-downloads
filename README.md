# Creator Collective Warm-up

Website: https://creator-collective-warmup.vercel.app/

The current product is a Chrome side panel plus a public web dashboard. Clicking the extension icon opens the packaged panel. Panel requests use an exact extension-origin sender check; web requests keep their existing origin bridge. The dashboard configures one user-started session against one explicitly selected Instagram or TikTok tab. A dedicated extension tab owns the timer and displays activity; panel starts leave this tab inactive. Closing the panel keeps the session alive; closing it stops the session. The web dashboard does not handle platform cookies or credentials.

## Current release status

0.6.14 keeps the higher automatic limits and makes likes pace toward the visible session goal sooner instead of waiting on random action selection. A 30-minute auto session shows 60 likes and now starts correcting if likes fall behind in the first few minutes, while still watching videos between actions and avoiding a like on every video. TikTok comments remain disabled. Account creation remains disabled; live high-engagement sessions remain unverified.

0.6.13 raises automatic engagement limits and slows down video browsing. A 20-minute auto session now defaults to 40 likes, 15 follows and 5 comments on Instagram. TikTok keeps comments disabled, so a 20-minute TikTok auto session defaults to 40 likes, 15 follows and 0 comments. Auto pacing now mostly watches videos for 8-18 seconds and tries full-video watches more often. Manual limits remain editable. Account creation remains disabled; live high-engagement sessions remain unverified.

0.6.12 adds TikTok warm-up sessions alongside Instagram. The dashboard and side panel now choose Instagram or TikTok, list tabs for that platform, open the selected platform, and run the timed browsing session against the right site. TikTok supports searching, scrolling/video watching, likes and follows; TikTok comments remain disabled until their live controls are verified. Account creation remains disabled. 199 automated checks pass; exact live TikTok warm-up remains unverified.

0.6.11 retries session completion messages and recovers unresponsive sessions after Stop, without replaying Instagram actions. Active settings and the selected tab appear consistently across reopened controls, while each surface keeps its saved next-session settings. Saved posts now expose their post Like control correctly. Account creation remains disabled. Focused regression checks and live release results are recorded in work_log.txt.

0.6.10 makes automatic warm-up amounts real editable values instead of placeholders. The panel includes comments in the automatic plan: 10 minutes at auto pacing yields maximums of 10 likes, 2 follows and 1 comment before overrides. Entering 0 disables an action; explicit overrides persist while untouched amounts continue to follow duration and pacing. Clearing a field is stable while typing and returns to automatic on blur, with invalid input still blocking Start. The comments switch, instructional hints and dashboard/panel footer links are removed, and the session minute number/unit share typography and alignment. Shared engine/API validation retains its prior explicit comment-enablement requirement for older clients; the updated UI sends that choice when starting. Account creation remains disabled. 174 tests pass; no live engagement or complete warm-up session has been run on this exact release.

0.6.9 returns the website and extension panel to auto warm-up only. Account creation is shelved behind a disabled bundled flag; no signup form or signup UI script is loaded. Updating stops old signup jobs and clears their temporary passwords while retaining mailbox history and access keys. TikTok and signup-email host permissions are removed. Private Instagram tabs are excluded from the warm-up selector. Existing pacing, limits, settings and warm-up behavior are unchanged. 164 tests pass; the exact updated extension still needs a live warm-up session after reload.

## Earlier signup releases

0.6.8 replaces the first recovered-signup Retry signup click with one automatic attempt on a recognized form, using the same email and birthday. The used retry is saved with the mailbox before acting and survives stop/restart and extension reload. Further recovered retries require explicit review; security checks, unknown forms and attempts already made in the active job never loop. Older sessions paused on Retry signup can proceed only on their pinned form. Existing login isolation and exact-recipient verification remain unchanged. 158 tests pass; live automatic retry, code entry and completed signup remain unverified.

0.6.7 recognizes Instagram's confirmation-code copy without requiring the literal word "email", while still requiring the exact visible saved recipient and a code-delivery prompt. A paused signup with details history can automatically resume once on that matching code screen; it never auto-resumes details or security checks. The final submission check reacquires the same form and waits up to three seconds for readiness without refilling or multiple clicks, and identifies a blocking field/button if it cannot continue. 151 tests pass. User screenshots confirm live details/birthday filling and reaching confirmation; the expected mailbox received a code. Automatic code entry and completed signup remain unverified.

0.6.6 fixes the recovered-signup dead end reported in the user's 4:57 pm screenshots. Recognized forms now offer an explicit Retry signup action that authorizes one submission with the existing mailbox and birthday. Approval is bound to the current Chrome tab, document and form; it is consumed before injection and revoked on a security pause, stop or changed step. It is never saved to local recovery. No automatic replay is enabled for uncertain history. 142 automated checks pass; installed live recovery, birthday selection and completed platform signup remain unverified.

0.6.5 uses the requested default birthday, May 30, 2006, on recognized Instagram Get started forms. Native selects, date inputs and uniquely identified listbox menus are supported. The selected date is verified before the existing guarded details submission; different dates already entered, security checks, unclear controls and uncertain prior submissions still pause. The birthday is retained with local mailbox recovery, not sent to the email service. 136 automated checks pass; live birthday selection and completed Instagram/TikTok signup remain unverified.

0.6.4 recognizes Instagram's Get started form with inline birthday controls and a Submit button. It fills the known account details without choosing a birthday or submitting that form. The panel asks the user to choose their birthday and press Submit in Instagram, then continue. Manual submission can advance to exact-recipient email verification. Prefilled details persist as an uncertain submission for restart recovery, preventing automatic duplicate signup. 128 automated checks pass, including a screenshot-based form fixture; completed live signup remains unverified.

0.6.3 automatically opens a private signup window after detecting an existing Instagram login when incognito access is allowed. Otherwise, it pauses with a visible permission action. The compact panel shows active elapsed time, freezes it during pauses, hides the inactive details form while running, and keeps the saved email behind an expandable row. Automated and isolated UI checks are not proof of live platform signup. Daily mailbox allocation limits remain unchanged.

0.6.2 reuses a saved unfinished mailbox when retrying the same platform and username, including after an extension reload. Prior submissions and older records without submission history pause for manual review instead of replaying signup details. Daily mailbox limits now show the local reset time; generic throttling remains a separate error. Existing server allocation limits are unchanged.

0.6.1 keeps native account creation in the Chrome side panel: platform, username, password, start. No student dashboard tab or login is needed. The extension prepares its own private account email and submits recognized signup steps once, including fresh email verification. If Instagram is already signed in to another account, continue opens a private signup window so the current login stays untouched. Birthday, phone, CAPTCHA, unavailable names, and unclear forms pause for the user. Completion requires matching signed-in profile navigation after a details submission; a home redirect alone never counts. Warm-up remains Instagram-only and is started separately.

The website provides a ZIP and manual Chrome setup instructions. This beta has not been submitted to or approved by the Chrome Web Store. Automated fixtures cover the signup flow, cancellation, ownership, and existing warm-up behavior. Live account creation still needs verification on each platform after this package is reloaded. Do not describe fixture results as successful live signups.

Passwords remain in temporary extension session storage. A generated 256-bit install capability and signup email history remain in extension-local storage for mailbox recovery; neither passwords nor the capability are shown to the public website. Update the existing unpacked folder and reload its Chrome card to preserve those records. New folders or removing the extension do not transfer local mailbox access.

The email service is the separate native endpoint on the existing student backend; it does not read other student aliases. Deploy that backend and configure its server-only secret and explicit established team owner before distributing this extension. The existing authenticated dashboard endpoint remains unchanged. No database migration is included.

## Development

`npm run check` runs extension authorization, cancellation, persistence and runner regression tests using Node's built-in test runner. `npm run package:extension` creates both a beta ZIP containing the extension folder and a root-layout ZIP for store submission. The packaging allowlist intentionally excludes environment files, browser profiles, tests and repository metadata.

The Instagram observer and session planner began from the desktop implementation. TikTok uses a separate conservative observer. They are bundled locally in the extension and require no remote executable code. Keep desktop and browser pacing changes synchronized deliberately; browser-specific cancellation and navigation are handled by runner.js and background.js.

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

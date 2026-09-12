# 0.6.35 tiktok photo posts and steadier sessions

TikTok search discovery excludes hidden links while keeping the order of rendered results. Video and photo post identities are preserved through opening, advancing, same-post query changes and comment history. Photo viewers resolve only their own media and action panel; slide arrows cannot advance to another post. Different manual destinations still stop the session.

TikTok no longer speeds up because engagement targets are overdue. Newly opened posts receive at least six seconds of watching while time remains, with session cancellation and keyword changes respected. Failed post openings use an accurate message instead of claiming the post is unavailable. Instagram pacing is unchanged.

Replace the files inside the existing unpacked folder, reload its Chrome card and reopen the panel. Verification details are in work_log.txt; a complete live extension-driven TikTok engagement session remains unverified.

# 0.6.34 automatic platform tab detection

The idle panel and web controls now refresh platform tabs after they open or finish loading, while preserving a valid selected tab. A newly opened TikTok tab no longer leaves Start disabled until a manual refresh. Platform changes cannot apply an older response to the wrong selector. Active sessions keep their existing ownership and actions. The public website now forwards the selected platform when listing or opening tabs; previously its TikTok controls silently used Instagram or failed to open a tab.

This repairs a reproduced tab-discovery problem, independently of the older TikTok controls visible in the reported screenshot. Versions before 0.6.32 still require an update for editable TikTok comments. Replace the files inside the existing unpacked folder, reload its Chrome card and reopen the panel. Exact release verification is recorded in work_log.txt; live extension-driven TikTok engagement remains unverified.

# 0.6.33 student dashboard version check

The student dashboard can read the installed warm-up version through a separate, read-only content script on the exact trycreatorcollective.com and www.trycreatorcollective.com origins. Requests must come from the top-level page with a valid matching nonce. Only the manifest version is returned; the existing warm-up command bridge and platform permissions are unchanged.

Packaging generates public release.json from release-notes/0.6.33.json, with the current version, release date, notes and production download/setup links. Both archives include the version script and are compared with source. Replace files in the existing unpacked folder, reload its Chrome card and refresh the student dashboard to enable the check. Browser verification remains pending.

# 0.6.32 tiktok comment parity

TikTok now shares Instagram's editable like, follow and comment targets. Its comment flow opens the active video's panel, types through the native editor, submits once and confirms a newly visible exact comment from the signed-in account. Manual drafts and changed account/post/caption state are protected; unclear submissions are recorded as unconfirmed without retrying. TikTok comment links and history survive panel reopening, worker recovery and Stop. Trailing caption hashtags no longer suppress an otherwise recognized comment detail.

Both installation archives include the new flow and are compared against source. Live signed-in TikTok DOM was inspected for permalink and search-dialog editors; actual extension-driven posting and a ten-minute live session on this version remain unverified. Update the files inside the existing unpacked folder and reload its Chrome card to install 0.6.32.

# 0.6.31 tiktok engagement repair

The downloadable extension now includes the TikTok feed repair and resolves likes/follows within one active video, including sibling controls and div/span targets. Search/profile previews remain results until opened. Explicit pressed/liked/following states confirm actions; uncertain clicks are never replayed. Recognized viewer close controls preserve search results. Visible access denials, sign-in, challenges and activity limits stop with clear recovery guidance. TikTok comments remain unavailable and are labelled in the controls.

The previous source-only feed fix was missing from the 0.6.30 ZIP. Both 0.6.31 archives are regenerated, and a release check compares every packaged file and shared mirror with source. A pull-request check prevents the same stale-download regression. Update the files inside the existing unpacked folder and reload its Chrome card. Downloading alone does not update existing installations. Regression tests use simulated TikTok pages; signed-in live engagement and ten-minute reliability remain unverified.

## previous release

# 0.6.30 warm-up only

The public website and extension side panel no longer show account creation or phone setup. Signup is disabled, including old runner recovery and phone-provider commands; the email-service and SMSPool host permissions are removed. The shorter lowercase comments from 0.6.28 remain. Existing saved mailbox and phone-order history is retained locally. Update the files in the existing unpacked folder and reload its Chrome card.

## Previous release notes

# 0.6.28 simpler warm-up comments

Instagram comments now use short, lowercase reactions with occasional emojis instead of repeating a caption inside “this part stood out.” Replies use recognizable caption details, vary their wording, and never repeat within a session. Captions without a supported detail skip comments. Processing stays local; no caption upload or new permissions. Update the existing unpacked extension folder and reload its Chrome card to use the new comments.

# 0.6.27 temporary SMSPool numbers

Phone setup lists temporary numbers for the selected Instagram or TikTok signup, using current SMSPool country prices. A number is purchased only when an eligible signup phone form is reached. Each order uses the displayed maximum price, cheapest-price selection, quantity one, and no renewal. The monthly rental purchase path has been removed.

The key stays in trusted extension session storage. Purchase intent is persisted before ordering; an uncertain outcome never automatically triggers another purchase. Confirmed receipts survive Stop and worker restarts. Paused signups can attach the exact active, unused order for the correct platform. Legacy monthly receipts remain preserved and require manual completion. Expired, cancelled and refunded orders pause without replacement spending.

The code is retrieved only for the saved order and selected platform. Existing codes are excluded before number submission, and phone/code submissions are not repeated automatically. Security checks and unclear forms still pause. Numbers expire after their temporary verification window; later phone checks may require manual help. Stop does not cancel an order; manage unused orders and refunds in SMSPool.

Provider contract: https://api.smspool.net/resources/postman.json and https://www.smspool.net/article/smspool-api-order-view-and-cancel-numbers-9883b6969fad. Paid orders and completed live signups remain unverified; automated checks use simulated provider responses.

---

## previous release: 0.6.26 account creation with SMSPool rentals

The Chrome side panel again exposes the existing single-account signup flow. Phone setup connects a user-owned SMSPool key in trusted session storage and lists current extendable, always-on rentals lasting 28–31 days with their prices. The chosen rental is purchased only after recognized account details have been submitted and an eligible signup phone-number form is observed. A fresh catalog/stock check precedes the purchase. No bulk queue, temporary-number rotation, security-check bypass, or automatic warm-up start is added.

The rental receipt is persisted before subsequent signup work; purchase intent is persisted before ordering. An ambiguous timeout or worker restart cannot trigger another purchase. A confirmed provider rejection permits retry after correction. Stop during purchase preserves any returned receipt and prevents subsequent page actions. A paused signup can attach the exact existing rental code to recover an uncertain order. Assigned rental codes cannot be reused for another local signup. Credentials are bound by a local SHA-256 fingerprint, and provider responses cannot echo secrets into error messages.

The recognized phone form receives the saved number once. SMS codes must be new relative to the message baseline captured before the number submission, explicitly identify the selected platform, and contain one six-digit code. The code form must show the exact number or its masked last four digits after a confirmed submission by this signup. Ambiguous or edited forms, country pickers without a verified adapter, CAPTCHA, account restrictions and security checkpoints pause for manual completion. This is ordinary signup verification, not an adapter for challenge/checkpoint pages.

Phone numbers and expiry are retained with the account. Renew numbers through SMSPool to keep them; this release does not turn on auto-renew or cancel paid rentals on Stop. SMSPool’s rental purchase API does not offer a documented maximum-price or idempotency parameter. We check current price against the selected quote immediately before ordering; this cannot eliminate a provider-side price change between the two requests. The rental selection is required again when starting a new/recovered signup that has no confirmed number, so choosing manual verification cannot silently reuse an old purchasing preference.

Primary provider contract: https://api.smspool.net/resources/postman.json. Public rental catalog checked September 10, 2026, including US product 11 at 28 days. The native email endpoint remains the existing production service. SMSPool keys are supplied only by the user inside the extension. Real paid rentals and completed live platform signups require a funded account and remain unverified until actually exercised. See work_log.txt for verification and release evidence.


---

# Creator Collective Warm-up

Website: https://creator-collective-warmup.vercel.app/

The current product is a Chrome side panel plus a public web dashboard. Clicking the extension icon opens the packaged panel. Panel requests use an exact extension-origin sender check; web requests keep their existing origin bridge. The dashboard configures one user-started session against one explicitly selected Instagram or TikTok tab. A dedicated extension tab owns the timer and displays activity; panel starts leave this tab inactive. Closing the panel keeps the session alive; closing it stops the session. The web dashboard does not handle platform cookies or credentials.

## Current release status

0.6.25 names the observed account in pending, confirmed, uncertain and skipped like/follow/comment activity. Comment messages include the exact submitted text, and comment-history links explicitly label whose post was commented on. Full generated comments with long usernames are retained without the previous activity truncation. Unknown accounts use a neutral post reference, never an invented username. Action settings, pacing, targets, confirmation and cancellation behavior are unchanged. Existing generic activity cannot be backfilled. Verification is recorded in work_log.txt.

0.6.24 retains exact comment text, post links, author, time and confirmation status in a separate session comment history. The dashboard, packaged side panel and runner share the same plain-text rendering; routine activity updates do not replace it or move its scroll position. History survives panel reopening and session completion in temporary extension session storage, and a new session starts empty. Confirmed comments and uncertain submissions are labelled separately; skipped/retained drafts are not presented as posted. Links and public fields are validated, and retries do not duplicate entries. No pacing, target or platform interaction changes. Earlier comment text was not recorded and cannot be backfilled. Verification is recorded in work_log.txt.

0.6.23 removes random skips of due engagement, schedules the like target before the final portion of the timer, and holds suitable unliked posts through short cooldowns instead of scrolling past them. Long watches and breaks respect the next planned like; deterministic relative target progress keeps follows and comments working too. Existing cooldowns, confirmed-only counters, uncertain-action allowances, duplicate checks, Stop and platform restrictions remain intact. All 254 automated checks pass, including 100 seeded ten-minute mixed-candidate simulations reaching exactly 30 likes with other actions enabled. A real ten-minute single-keyword session completed normally with 77 scrolls, 30 confirmed likes, 8 confirmed follows and 3 confirmed comments. The follow target was 9, so not every target was met. See work_log.txt for details.

0.6.22 preserves Instagram search progress by closing the post viewer instead of reloading the search. It consumes loaded results in order, refreshes the Next sequence without hiding duplicate tiles, checks watched history before Next, and treats p/reel aliases as the same post. A single keyword no longer restarts after eight browsing steps or on exhausted results; it waits for new results while the timer continues. Engagement settings, confirmation guards and keyword rotation remain intact. All 251 automated checks pass; live release verification is recorded in work_log.txt.

0.6.21 preserves an untouched owned draft when Instagram replaces its textarea, while document-level manual-edit detection protects replacement fields too. Adoption requires the old field to be detached and the exact post, account, caption and text to match. Short sessions use shorter initial and cross-action waits; late actions require enough time for confirmation. Caption replies remain exact short extracts from niche-matching captions. A real two-minute Instagram session completed normally with 21 scrolls, 1 confirmed like, 1 confirmed follow and 1 confirmed comment. All 241 automated checks pass. See work_log.txt for details and remaining store/client-machine verification.

0.6.20 recovers from slow/empty searches, missing results, viewer load timeouts and transient frame replacement. Read-only inspections retry; uncertain engagement is never replayed and consumes the corresponding allowance without inflating confirmed counts. Transient activity acknowledgements retry before the next page action. Equivalent post permalink forms no longer cause cancellation; different posts, account restrictions, Stop and deadlines retain their existing guards. Includes comment-draft recovery and explicit follow confirmation. Verification and installed-version details are recorded in work_log.txt.

0.6.30 keeps TikTok sessions running when TikTok performs its normal search-route and video-URL rewrites. It still stops when the selected tab actually moves to another video or leaves TikTok.

0.6.19 confirms Instagram follows when the viewer hides the Follow control without replacing it with Following. After the existing confirmation window, a read-only background tab reloads the exact same post and checks its author's explicit Following or Requested control. The tab closes after checking; no follow is repeated. Unknown outcomes remain uncounted and do not stop the session. Header filtering also finds the author's control when unrelated controls occur earlier in the page. Live read-only inspection confirmed that the author from the reported zero-count session is currently followed, and the standalone post exposes Following. A newly executed follow and comment on this release remain unverified.

0.6.18 recovers from comment drafts that cannot be submitted. The same unchanged, extension-owned composer can submit after losing focus, with up to eight readiness checks before one click. Unavailable controls clear only the exact unsent draft and skip that comment. If cleanup cannot be confirmed, further comments pause while browsing, likes and follows continue; paused comments no longer influence pacing debt. Stop, deadlines, account restrictions, identity checks and no-replay behavior remain enforced. Live DOM inspection confirmed a populated textarea and enabled Post control with focus elsewhere; the exact release has not posted a live comment.

0.6.17 keeps a warm-up running when Instagram accepts an action but the app cannot confirm it immediately. Follow confirmation now waits longer, and unconfirmed actions are logged without retrying the same person or ending the session. Counts still include only confirmed actions. Account creation remains disabled; live high-engagement sessions remain unverified.

0.6.16 changes the visible amounts from loose caps into target-driven behavior. Likes, follows and comments now each track their own expected progress and the session skims faster when any supported action falls behind. A 10-minute fixture with enough safe actions lands close to the visible 30 likes, 9 follows and 3 Instagram comments instead of passively browsing. Unsupported or unsafe actions still skip. TikTok keeps comments disabled. Account creation remains disabled; live high-engagement sessions remain unverified.

0.6.15 makes browsing more varied after live testing feedback. Auto pacing now mixes quick skim bursts, slower watches and occasional full-video watches when playback and remaining time allow it. A 30-minute auto session now shows 90 likes, 27 follows and 8 Instagram comments; TikTok keeps comments disabled. Likes still pace toward the visible goal without liking every video. Account creation remains disabled; live high-engagement sessions remain unverified.

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

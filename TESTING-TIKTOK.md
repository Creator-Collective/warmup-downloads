# TikTok test build

A separate, TikTok-only build of the warm-up extension for testers whose desktop TikTok likes and follows stick. It runs the same engine as the Instagram build (search, watch, likes, follows, comments, targets, resume, results) with the same caps and pacing. The Instagram build, its release files and its website are not touched by anything here.

## What is different from the Instagram build

| | Instagram build | TikTok test build |
|---|---|---|
| Name | Creator Collective Warm-up | Creator Collective TikTok Warm-up (test) |
| Sites it can open | instagram.com | tiktok.com only |
| Content scripts | website bridge and student-page version check | none |
| Where it runs from | website or side panel | its own side panel only |
| Toolbar | plain icon | black TT badge |
| Extension id | from the folder path (unpacked) or the store | fixed: `pgkkhpbafojddlaaijcebdjdagakhaca` |
| Version | three parts, `0.6.57` today | `<instagram version>.<n>`, shown as `<instagram version> tiktok test <n>` |
| Help links | the Instagram website | `tiktok-test.html` inside the extension |
| Test tools | none | check this page, copy test report |

Everything else is byte-for-byte the files in `browser-extension/`. The only files that differ are `manifest.json`, `features.js`, `sidepanel.html`, `runner.html` and the added `tiktok-test.html`. `bridge.js` and `version-bridge.js` are left out.

Flavor files live in `flavors/tiktok/`:

- `manifest.overrides.json`: a JSON merge patch over `browser-extension/manifest.json`. `null` removes a key (it removes `content_scripts`).
- `features.js`: `platforms: ['tiktok']`, `testTools: true`, and the TT toolbar badge. The badge is set whenever the service worker starts and again on Chrome startup, because Chrome forgets badges on restart.
- `tiktok-test.html`: a static page with no scripts. It has install and update steps, the tester protocol and the privacy note. The side panel's brand, "setup help" and "set up extension" links and the session tab's logo all open it.
- `build.json`: the committed build counter.

## Building

```
node scripts/package-tiktok-test.mjs --next-build   # after any change: numbers the next build
node scripts/package-tiktok-test.mjs                # rebuilds the numbered build, byte for byte
```

The output is `dist/creator-collective-tiktok-test-<version>.zip` and `dist/SHA256SUMS.txt`. `dist/` is ignored by git and is never deployed. The zip's top folder is `creator-collective-tiktok-test`, so it can't be mixed up with the Instagram `creator-collective-extension` folder.

Build numbers: `flavors/tiktok/build.json` records the build number, the Instagram base version and a hash of everything the build contains (except its own version). A plain run rebuilds that exact build and refuses if anything has changed. `--next-build` records a new number, and it refuses when nothing has changed, so each number maps to one set of contents. The number starts again at 1 when the Instagram base version moves up (0.6.57.3 is followed by 0.6.58.1), so the full version always goes up. Commit `build.json` after `--next-build`.

The packager does not need the Instagram release check to pass. A TikTok iteration therefore doesn't force a new Instagram release. It stops if any of these fail:

- the root dashboard files and their `browser-extension/` copies differ, or `browser-extension/sidepanel.html` isn't generated from `index.html`
- `browser-extension/` holds a file that isn't in `store/build-manifest.json`, or the list names a missing file
- the merged manifest asks for anything but the two TikTok host patterns, adds permissions, keeps content scripts, or has an invalid key
- `features.js` isn't the TikTok list with test tools
- an expected piece of Instagram markup in `index.html` or `runner.html` isn't found exactly the expected number of times, or any Instagram text or website link is left in the TikTok side panel or session tab
- any packaged file differs from its source, a referenced file is missing, or a page links outside the extension

It stages in a temporary folder. It writes only the zip, `SHA256SUMS.txt` and, with `--next-build`, `build.json`. It never writes `browser-extension/`, `release.json`, `store/`, `setup.html` or the Instagram zips. `tests/tiktok-test-package.test.cjs` runs it for real and checks all of this.

Delivery is the owner's call. The zip plus `SHA256SUMS.txt` can go on a GitHub pre-release (never marked latest) or be sent directly. Don't use a Vercel preview, don't add it to `release.json` or `setup.html`, and don't rename it to `creator-collective-extension-*`, which is the Instagram deploy allowlist.

## Replacing an older test build (one copy only)

The manifest carries a fixed public `key`, so every test build has the id `pgkkhpbafojddlaaijcebdjdagakhaca`, whatever folder it's loaded from. Chrome can hold only one extension per id. That matters because two TikTok builds with different ids could each start a session on the same TikTok tab: each build's "already running" lock only sees its own storage. The key is public by design. Its private half was never kept, because unpacked loading doesn't need it. The Instagram build has no key.

Checked in Chrome for Testing 153 through the same installer as "Load unpacked" (`UnpackedInstaller`):

- test 1 loaded from `creator-collective-tiktok-test`, then test 2 loaded from `creator-collective-tiktok-test 2`: one card and one service worker remained, showing test 2 from the new folder
- the same two folders without the key: two separate extensions
- the Instagram build loaded alongside kept its own id
- the TikTok build showed the TT badge, no content scripts, only the TikTok hosts, a connected TikTok side panel with test tools, and "this test build runs tiktok only." for Instagram requests

Update steps for testers, also on `tiktok-test.html`: stop any session, remove the old test card in `chrome://extensions`, delete its folder, then load the new folder unpacked. If they skip remove, the key still leaves one copy. Removing clears the panel's saved keywords and targets.

## Tester protocol

The tester follows `tiktok-test.html`. This is the same protocol with the evaluator's detail. After every session the tester sends the copied test report and a side-panel screenshot. The report has only counts, yes/no and fixed codes: no URLs, handles, captions, keywords or comment text.

Reading the report:

- **Attempts.** Each like or follow the engine clicks is checked in place and then on a fresh page. These are the entries of `like checks, in place to fresh page` and `follow checks, in place to fresh page`, for example `ok to persisted 3, ok to reverted 1`. The number of attempts is the sum of those entries.
- **`ok to persisted`**: shown in place and still there on a fresh load.
- **`ok to reverted`**: shown in place, gone on a fresh load, meaning TikTok undid it.
- **`not-liked to …` or `not-following to …`**: the click never registered in place.
- **`… to timed-out`**: the fresh page didn't answer within the 8 s check window.
- **`no-control`, `no-post`, `moved`, `unreadable`**: the page structure wasn't what the reader expects. The next step is the page check, not a code workaround.

### 1. Precondition: hand-made likes and follows stick

With the extension turned off, on desktop Chrome in the profile used for testing, the tester likes one video and follows the account that posted it. They reload both pages, wait 2 minutes and reload again.

- Pass: both are still there after both reloads.
- Fail: stop. The account undoes engagement, as the owner's accounts do, and no build can validate likes or follows on it. Report it as an account result, not an extension failure.

### 2. Read-only page check on five pages

With no session running, the tester picks the tab in the side panel and presses "check this page" on:

1. search results for one of their keywords
2. a video opened from those results, from an account they don't follow
3. a photo post
4. that photo post with comments open
5. the step-1 video, freshly reloaded

Pass: every page reads `tiktok page: yes · language en · block none`. Then, per page:

1. `search page: yes`, `keyword in address: yes` and `result cards` above 0
2. `post found: yes`, `like control: yes`, `follow control: yes` and `next: yes`
3. `kind photo`
4. `comment box: yes`, `own profile link: yes · accounts 1` and `comment blocker none`
5. `liked: yes`, plus either `following: yes` or no follow control. This settles whether TikTok keeps the follow control visible after a follow, which follow confirmation depends on.

Any `no` points at a selector in `browser-extension/tiktok.js`. Fix it through the jsdom fixtures, working from this structural description only, never from a raw page capture. Then build a new test number.

### 3. Small targets

**3a. Motion only.** 5 minutes, two keywords, targets 0/0/0.

- Pass: `ended: deadline 1`, `next` at least 10, `searches` at least 2 (both keywords), no `page-changed`.
- Resume run: stop at about 2 minutes, press resume, let it finish. Pass: `runs 2`, `ended: stopped 1, deadline 1`, `left 0:00`, and the timer carried on from the frozen remaining time.

**3b. Likes and follows.** 10 minutes, targets 3/1/0.

- Pass: at least 2 like attempts and 1 follow attempt, every attempt `ok to persisted`, and zero `timed-out`. The pass is judged over attempts, not over confirmed actions, because a confirmed TikTok action is persisted by definition.
- The tester then opens their liked videos and following list: every confirmed like and follow is there.
- Any `to reverted` or any `not-liked`/`not-following` in place: stop and report. Manual actions stick, so TikTok is refusing or undoing this build's clicks. Per scope, there's no workaround: no trusted input, no detection workarounds. Report that the TikTok test is not viable.
- Any `timed-out`: report it with the machine details. The 8 s window changes only on this evidence and only within the 22 s like budget.
- Fewer attempts than required: rerun once with more on-niche keywords.

**3c. Comments.** 10 minutes, targets 0/0/1, then 0/0/2, using keywords the videos actually talk about.

- Pass: each comment the panel lists as posted appears exactly once under its video after a reload, is short and on topic, isn't repeated and has no links. The report shows `comment submit problems: none`, and `comment checks` shows `confirmed` for each posted comment.
- `composer-empty` in `comment submit problems` means TikTok ignored the pasted text. Report it with no workaround.
- A posted but uncounted comment: send the `comment checks` code.
- Comments paused for a leftover draft: the tester reopens that video, opens comments and runs the page check. `has text: yes` means TikTok restored the draft; `no` means it didn't. No live evidence exists either way yet, and the draft safety depends on it.

### 4. Default targets

40 minutes, automatic targets 60/18/7, **2 to 7 keywords**, run to the deadline.

- Pass: `ended: deadline 1` and `blocks: none`.
- At least 80% of each target is confirmed: 48 likes, 15 follows and 6 comments. If not, the report's codes explain the gap (for example, targets are upper limits and captions didn't fit).
- For like attempts and, separately, follow attempts: at least 90% are `ok to persisted`, none is `to reverted`, and at most 1 is `timed-out`.
- No repeated comment appears in the panel's comment list.
- Searches: `searches` counts every loaded search, recoveries included. The expected number of keyword searches is `ceil(40 / W)`, where `W = min(KEYWORD_WINDOW_MS.tiktok, 40 / keywords)` minutes. `KEYWORD_WINDOW_MS` is in `browser-extension/session.js`; it is 2 minutes for TikTok at this commit, giving about 20. If Phase 5 raises it to 6 minutes, 2 to 7 keywords give about 7. Pass: between that number minus 1 and that number plus `max(2, keywords)` recoveries. With a single keyword there's no rotation, which is why 2 to 7 keywords are required.
- Compare with the TikTok simulation and the Instagram baseline in `LIVE_VERIFICATION.md`.

**Restart safety**, in one more default session: the tester reloads the session tab once, then resumes from the side panel.

- Pass: the session stops with "session stopped after its tab refreshed", and the report shows `ended: tab-refreshed 1`. Resume is offered and completes, and no video gets a second like, follow or comment.

### Safety stops, in every step

- A verification, puzzle, captcha, "too fast" or "try again later" screen must stop the session by itself, with the matching panel message and a `blocks:` code (`challenge`, `rate-limit`, `sign-in`, `access-denied`, `language`). The tester reports it and doesn't run again for 24 hours.
- If a challenge shows and the session doesn't stop, the tester presses Stop and sends a screenshot. That's a blocking bug.
- TikTok's auto scroll must be off. If TikTok moves to another video on its own, the session stops with a page-changed message (`ended: page-changed`).

### Recording

Append each tester's report, installed version (`version` line), build date and results to `LIVE_VERIFICATION.md` and `work_log.txt` in the existing style. Nothing counts as live-verified until a tester's reports show it.

## Privacy

The build can open and read only tiktok.com tabs. It has no website bridge, no content scripts, no `externally_connectable`, and no network calls of its own. Panel settings stay in the extension's local storage. Session activity and comment history (text, video link, author) stay in Chrome session storage and clear when Chrome closes. The test report and page check carry only whitelisted numbers, yes/no values and fixed codes, and leave the browser only when the tester sends them. Removing the extension deletes its storage.

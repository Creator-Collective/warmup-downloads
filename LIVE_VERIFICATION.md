# tiktok verification status

Updated 2026-09-14. Overall status: not fully verified. Automated checks do not establish that TikTok accepted a live action.

## installed 0.6.38

The earlier live observation confirmed 0.6.38 through the student dashboard and used the signed-in account. The recorded ten-minute run on September 14, 03:38:50–03:48:50 UTC, used personal branding with targets of one like, one follow and one comment.

- Timer completed normally: 32 advances, one confirmed like, one confirmed follow, zero comments.
- The recorded like was on @juliabroome. The recorded follow was on @abigaildaniella_. No successful comment was observed.
- A loaded photo viewer reached late in the session stayed open while activity repeatedly reported unsuccessful post openings. DOM observation found the signed-in avatar in DivCommentBarContainer / DivEnhancedBottomCommentContainer outside comment-input. The primary-photo author check treated it as a conflicting author.
- A subsequent three-minute comment-only run hit the same photo problem and was manually stopped after roughly one minute. Another three-minute comment-only run was last observed near its end with zero comments. Its final result was not captured; it is not a passed test.

## 0.6.39 change

Exclude only the observed bottom comment wrappers from primary-post discovery. Fixtures cover the signed-in avatar on both photo and video viewers, preserve rejection of genuinely conflicting authors, and verify that the comment account and one-time submit checks remain intact.

## installed 0.6.39 live run

User explicitly reauthorized the live test. The student dashboard handshake confirmed installed 0.6.39. Signed-in @ollyexplains; September 14, 17:03:17–17:13:17 UTC; ten minutes; personal branding; relaxed pacing; targets 1 like, 1 follow, 1 comment.

- Timer completed normally: app counters 23 scrolls, 1 like, 1 follow, 0 comments. This is a failed engagement test.
- Like persisted after a fresh navigation to @salemkinging/video/7662645033958526215: Like video remained pressed.
- App recorded a follow on @juliabroome/video/7625708232819920142 at about 17:11:23 UTC. Fresh profile showed Follow, not Following. The counter was a false confirmation.
- At 17:12:34.145 UTC the app reported drafting “more on finding your own voice?” on @momopill/video/7662754547101715742. At 17:12:34.137 UTC TikTok's React console emitted `NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.` The viewer displayed “Something went wrong”; no editor or posted comment remained visible. Recovery continued the session, disabled comments and did not count a comment. Native insertText's interference with controlled DOM is the candidate mechanism; the timing of the crash is directly observed.
- The ten-minute run did not reach a photo. A subsequent one-minute browsing-only run (17:18:54–17:19:54 UTC, long personal-brand search, targets 0/0/0) completed with five advances but also did not reach a photo. Neither run verifies the photo fix.
- Subsequent direct diagnostic: TikTok's ordinary profile Follow button for @juliabroome showed Following after one click, but reverted to Follow after reload. This was separate from the extension session and is not an extension pass. No further follow retry was attempted; the underlying rejection reason is unknown.

## 0.6.40 checks and remaining verification

The runner uses the editor's standard paste event instead of native insertText. A local hidden browser test using real React 18.3.1 and Draft.js 0.11.7 accepted the exact draft into controlled state and retained it after rerender. The automated real-editor test also verifies exact local submission and editor clearing without React errors. These exercise editor behavior, not TikTok's custom paste handling or server acceptance.

Native automatic draft deletion is removed for TikTok: failed submissions preserve the draft and pause comments. A trial of selection plus Backspace in the local fixture removed only the final character, so that approach was discarded and is not shipped. Follow confirmation now requires a separate loaded post, never retries the click, and checks the same post/author while respecting cancellation, navigation and platform restrictions.

An installed 0.6.40 run still must demonstrate a new visible own comment, a follow that survives fresh navigation, a photo transition, and normal timer completion. The browser tool blocks the extension-management page, so applying an installed update requires the user; no alternate control path is used. Do not label TikTok fully ready based on automated checks or counters alone.

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

The initial 0.6.40 handoff required a new visible own comment, a follow that survives fresh navigation, a photo transition, and normal timer completion. Results from the next installed test are recorded below. The browser tool blocks the extension-management page, so applying an installed update requires the user; no alternate control path is used. Do not label TikTok fully ready based on automated checks or counters alone.

## installed 0.6.40 live tests, September 14 afternoon

The student dashboard confirmed installed 0.6.40. Signed-in @ollyexplains. All runs used relaxed pacing.

- Three-minute comment-only run, 18:15:35–18:18:36 UTC, personal branding, targets 0 likes / 0 follows / 1 comment: timer completed normally with 11 advances. At 18:18:11 UTC the own comment “the personal part gets forgotten so fast” appeared on @salemkinging/video/7662645033958526215, the editor cleared and the visible comment count changed from 2066 to 2067. Fresh permalink navigation and reopening Comments retained the same /@ollyexplains row. No editor crash occurred. The app nevertheless recorded zero comments and “not confirmed”; posting and persistence passed, automatic confirmation failed.
- A subsequent three-minute 1 like / 1 follow / 0 comment run recorded a like on the same Salem post and six advances, then stopped after its background runner tab closed. The platform and dashboard tabs remained open; what closed the runner was not observed. This is not a completed timer or follow test.
- One-minute browsing-only run, approximately 18:26:02–18:27:03 UTC, great_reads_library, targets 0/0/0: completed normally with four advances. Observed distinct photo permalinks under @great_reads_library: 7684263591825919252 → 7683585987947023636 → 7681985656582589716. These were post transitions, not horizontal carousel slides. No unavailable-post loop or early stop occurred.

- Focused follow run started 18:27:35 UTC with personal branding and targets 0/1/0. At 18:29:24 UTC @jamieegabrielle/video/7559649022097526030 showed Following after the attempt; the fresh-page check returned uncertain and the app correctly retained zero follows. The run was deliberately stopped at 18:29:47 UTC after six advances to inspect persistence without further attempts. Fresh @jamieegabrielle profile showed Follow again. No follow retry was made. Follow persistence failed; the underlying platform reason is unknown.

## 0.6.41 change and remaining checks

A reproduced false-negative confirmation used DOM node identity for every prior comment. Remounting unchanged older rows invalidated an otherwise new own comment. The baseline now compares a multiset of author and normalized text, preserving duplicate counts; changed/missing rows, old own duplicates, reused nodes and interrupted ownership remain unconfirmed. The precise cause of the observed live false negative was not captured before navigation, so this is a demonstrated robustness fix, not a claim that the installed counter test has passed. Fixed failure reasons are logged once without comment/account payloads.

A successful installed comment-counter retest and a follow that remains accepted after fresh navigation are still required before calling TikTok fully ready.

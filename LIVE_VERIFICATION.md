# tiktok verification status

Updated 2026-09-18. Overall status: not fully verified. Automated checks do not establish that TikTok accepted a live action.

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

## 0.6.42 complete-flow release, September 17

The user authorized proceeding with TikTok follows included, without treating the earlier rollback as a release blocker. This does not establish the cause of the rollback or prove acceptance on another computer. Follow attempts and positive fresh-page confirmation remain enabled; uncertain attempts never become confirmed counts.

This release adds per-platform saved settings, confirmed counts against session targets, durable unconfirmed/paused-action reporting, and preservation of in-flight results during Stop. Successful follow and mixed-outcome session paths are covered with local fixtures. No Chrome control or real likes, follows, comments, messages or account logins were performed. Installed 0.6.42 and the earlier live comment-counter fix still need user-side verification.

## installed 0.6.46 live tests, September 18

Setup confirmed installed 0.6.46. The signed-in TikTok profile was @ollymode. All sessions used the saved keyword personal brand. No comments were drafted or posted.

- One-minute browsing-only run, approximately 19:12:28–19:13:28 UTC, targets 0/0/0: completed normally with three reported advances. A first post opening failed, recovered on another result, and ended in the loaded @jamieegabrielle video 7559649022097526030.
- A second one-minute browsing-only run was deliberately stopped with 26 seconds remaining after one advance. Direct observations showed @kelcapital/video/7631769952189500703 followed by @theanatomyofadream/video/7671041826958167310. The latter URL and counters stayed unchanged after Stop; settings became editable and Start returned.
- Two-minute engagement run, approximately 19:16:28–19:18:28 UTC, targets 1 like / 1 follow / 0 comments: completed normally with seven advances, one recorded like and one unconfirmed follow. The app logged a like on @theanatomyofadream/video/7671041826958167310 at 19:17 UTC. Fresh permalink navigation after completion showed the exact primary-post button “Like video 18.1K likes” with aria-pressed=false. Like persistence failed and the recorded count was a false confirmation.
- Follow attempt on @juliabroome/video/7625708232819920142 stayed unconfirmed with zero follows. Fresh profile navigation showed “Follow julez | social media”. No follow retry was made. The cause of TikTok not retaining either action was not established.
- Separate ordinary-click comparison with the extension stopped, approximately 19:23:30 UTC: the same primary-post like button immediately showed pressed=true, reverted to false within about 20 seconds before reload, and remained false after reload. No additional click was attempted. This shows the persistence failure also occurred through the ordinary TikTok control; it does not identify its cause.
- Original five-minute duration and zero targets were restored. All 465 existing automated checks passed and both 33-file 0.6.46 archives matched source. Instagram had no open signed-in tab and was not tested live.

## 0.6.47 correction and remaining checks

TikTok likes now use independent fresh-post confirmation before incrementing the count, reusing the guarded follow-verification path. A temporary optimistic heart is insufficient. Uncertain attempts consume the allowance without repeating the click. The action reserves time for confirmation; Instagram likes keep their previous behavior.

This corrects a demonstrated reporting failure. It does not establish why TikTok discarded the action or make TikTok accept it. Installed 0.6.47 like confirmation, durable likes/follows, and the installed comment counter still require live verification.

## 0.6.48 follow-up, September 18

The setup handshake still reported installed 0.6.46 while the available download was 0.6.47. No TikTok or Instagram tab was open at this follow-up, and no session or social action was started. The current extension audit found one additional reproducible product inconsistency: website Start activated the runner tab even though setup describes it as a background tab.

Both website and panel now create the runner inactive in the selected platform tab's window. Existing zero-target exclusion, per-platform settings, Stop recovery and comment guards remain unchanged. The prior live like/follow rollback cause remains unknown. Browser security policy blocks extension-management automation, so the installed update still needs the user. A new explicit comment-test request is pending; no comment was posted.

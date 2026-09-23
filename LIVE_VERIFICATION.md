## 0.6.57 reach warm-up targets and write instagram comments, September 23

All 685 automated checks pass. Both 36-file archives and packaged dashboard mirrors match source. Independent code and security/account-safety reviews ran; their findings were fixed before packaging: each session now uses its own random comment salt so different students do not post identical wording on the same post, three replies that assumed a video were reworded, business closure and burnout captions are skipped as sensitive, and hidden zero-width characters are stripped before the suspicious-caption check. The pull request reviewer's findings were also fixed: a stop during the leftover-draft check still shows the draft warning, and the paused-comments note uses neutral wording.

Simulation (real plan, writer and engine via vm, fake instagram, 12 seeds, 40 min auto pace): before 21.9-69.5/120 likes, 6.2-19.3/36 follows, 2.1-5.0/10 comments depending on how often captions repeat the keyword; after 58.2-58.5/60 likes, 16.9-17.2/18 follows, 5.8-5.9/7 comments in every scenario. At most 2 actions per post, at most 5 action starts in any minute at 40 min, 0 repeated comments, about 7 searches instead of about 20. Comment corpus of 255 realistic captions across 15 niches: 11 replies (4.3%) before, 158 (62%) after, no niche at zero, no caption text echoed.

No Chrome control, installed-extension reload, Instagram session, or social action was performed. Real Instagram layouts, search results and comment confirmation were not retested live; detection fixes are checked against jsdom layouts only. TikTok stays off. Existing unpacked installations require replacing files and reloading; the website deployment alone does not update them.

# warm-up verification record

## 0.6.56 resume and instagram page transitions, September 21

All 615 automated checks pass. Both 35-file archives and packaged dashboard mirrors match source. Independent code, JavaScript and security reviews have no remaining findings. Tests cover bounded post/search transitions, equivalent keyword encoding, timeout recovery, unrelated/manual navigation stops, remaining-time freeze during delayed Stop acknowledgement, saved targets/counts, uncertain-action reservation, comment draft pauses, old-token rejection, concurrent resume prevention, legacy-extension compatibility, and a real engine checkpoint through background persistence and resumed-runner handoff.

No Chrome control, installed-extension reload, Instagram session, or social action was performed. The screenshot does not prove the exact original URL event; the reproduced transition cases are fixed. Resume requires a session started with 0.6.56 and retained browser session storage. Previous-version sessions and browser restarts cannot be recovered. Existing unpacked installations require replacing files and reloading; the website deployment alone does not update them.

## 0.6.54 instagram-only warm-up, September 21

All 587 automated checks pass. Both 35-file download archives and packaged dashboard mirrors match current source. Independent code, JavaScript and security reviews found no actionable issues. Coverage includes Instagram-only commands, stored TikTok jobs in starting/running/stopping states becoming stopped without tab actions, preserved historical results, Instagram starting afterward, separate saved preferences, and older installed extensions exposing Stop without TikTok focus controls.

No Chrome control, extension installation/reload or social actions were performed. This is not a live Instagram session verification. Existing unpacked installations need new files and a reload; publishing alone does not update them. TikTok support is temporarily unavailable, with its prior source and verification history retained below.

## 0.6.53 stalled search recovery, September 19

The reported Instagram session repeatedly alternated between scrolling and no new results while the timer continued. The screenshot does not establish why Instagram initially stopped advancing. This release adds bounded search recovery, retains seen-post and action history, selects the results scroll area, and confirms a real position change before reporting a scroll. Persistent failure stops the session with help instead of consuming the remaining timer.

All 581 automated checks pass, including recovery, scrolling, cancellation and archive integrity. Five recovery regressions fail against the previous code and pass with this fix. Independent code, JavaScript and security reviews found no remaining issues. This release has not been verified in an installed extension or against live Instagram or Carson's account. No Chrome control, account inspection, messages, likes, follows or comments were performed. Target completion and platform acceptance are not guaranteed. Publishing the download does not update an existing unpacked installation.

Updated 2026-09-19. Installed 0.6.49 passed the requested TikTok motion test below. Account acceptance is excluded from that criterion at the user's request. Public comment delivery and the new Instagram timing in an installed extension are not claimed verified.

## 0.6.52 tiktok search and confirmation verification

September 19: 553 automated checks pass, including 36 new checks. Independent JavaScript, code and security reviews approve the production changes. Both 35-file archives and dashboard mirrors match source. No app build was run.

Live read-only/navigation inspection of the existing TikTok tab, under the user's earlier explicit test authorization, verified the current Top and Videos search-card structures. The personal brand search returned posts with #personalbranding or no literal phrase. A real caption contained a mention of another profile inside browse-video-desc while the primary author remained separate. These observations match the locally reproduced eligibility and author-confirmation failures. TikTok was restored to its home feed. No likes, follows, public comments, extension installation/reload or foreground window control occurred in this verification.

The fixed search membership is local to one requested query and resets before each search, including failures. It accepts only captured rendered result cards with one canonical post, preserves the exact author, excludes visible viewers and unrelated links, and is bounded in size. Caption-based eligibility continues to work. Comments still require a relevant supported caption and unused wording; no generic comment fallback was added. Skipped controls, missing relevance and exhausted wording now have bounded activity explanations instead of silent inactivity.

Three composed tests use the real session engine, TikTok DOM observer, draft/submit transport and fresh-page engagement confirmation. Browser APIs, page delivery, account acceptance and time are explicitly simulated:

- Healthy simulated 60-minute run: 180 confirmed likes, 56 of 57 follows, 16 comments, 272 advances and 30 searches. Actual local clicks/submissions match the counts, with no replay. The hashtag wording mismatch is exercised.
- Mixed-failure simulated hour: 161 confirmed likes plus 19 uncertain likes, 44 confirmed follows plus 13 uncertain follows, 15 comments, 227 advances and 30 searches. Thirty-four transient confirmation reads recover. No-op clicks never become successes, and an uncertain action is not clicked again.
- Stop interrupts the composed flow without further actions. Confirmation tabs are inactive, destination-owned and cleaned up. Separate regressions cover restrictions, deadline expiry, genuine author conflicts, recommendation exclusion, query changes, zero targets and missing controls.

A personal-brand-only caption feed can still exhaust the limited relevant comment wording before reaching its comment target. The run continues other eligible actions and reports that reason. Targets are limits, not guaranteed delivery. The user's account-level persistence issue does not establish how Carson's account behaves, and Carson's installed version is unknown. The last observed local installed copy remains 0.6.49; publishing this package does not update an unpacked installation. Full installed 0.6.52 persistence on another account and current public comment delivery are not claimed verified.

## 0.6.51 controls and setup verification

September 19: 517 automated checks pass, both 35-file archives match source, and independent JavaScript, code and security reviews approve the change. Focus changes are bound to the active session identity and validated before updating only its focus; tests cover stale sessions, Stop races, deadlines, paused/zero targets, cooldowns, current storage reads, and old extensions without the capability. Existing zero-mix preferences become explicit zero targets.

A hidden in-app browser loaded the real website and packaged panel files from a disposable local server, with clearly synthetic extension replies. Desktop and 320px/400px layouts showed working platform-icon dropdowns, second-precision activity, focus beside running results, installed/current/outdated/disconnected setup states, three-step installation/update flows and all illustrated walkthrough steps. No horizontal overflow at 320px; no setup console errors. The fixture reproduced the panel's Chrome-only running layout because localhost is not an extension origin. These UI checks are not an installed-extension session test or proof of Chrome manager opening.

No Chrome control, installation changes or real social actions were performed for this UI release. The last observed installed copy is 0.6.49. Website styling/setup update independently; live focus and the packaged side-panel changes require the updated extension. No further download or user-run test was requested. Prior TikTok motion verification and account-acceptance limits below remain unchanged.

## installed 0.6.49 motion test and 0.6.50 viewing verification

September 19, approximately 17:40–17:47 UTC, signed-in TikTok. The setup handshake identified installed 0.6.49. The user reported that ordinary manual likes and follows also fail on this account and explicitly accepted attempts, rather than persistence, as this test's criterion. This does not establish a success percentage on other accounts.

- A five-minute relaxed session with personal brand and storytelling, targets 1 like / 1 follow / 0 comments, completed naturally with 15 advances. Both keywords were reached, followed by a return to the first keyword. A like and a follow were each attempted once and correctly remained unconfirmed. Loaded, playing media and recovery after failed openings were observed; the platform tab remained visible.
- A separate zero-engagement session was stopped after roughly 23 seconds, with 37 seconds left and two advances. Start returned and settings unlocked. The session remained stopped. Five minutes, personal brand, relaxed pace and zero targets were restored; TikTok was returned to its home feed.
- The live comment editor accepted a draft without submitting it. A fresh revisit to that exact post, with Comments opened, confirmed the composer was empty after cleanup. No public comment was posted. Local real React 18 / Draft.js tests cover draft entry, rerender, one-time submission, editor clearing and new own-comment confirmation; these are not proof of current live TikTok comment delivery.
- Prior live photo navigation evidence is retained below. Current automated checks cover video/photo identification and recovery, both launch surfaces, inactive runner placement, multiple keywords/batches, action guards, interrupted results, restart recovery and comment eligibility. No claim is made that every platform layout or other user's account was exercised live.

The Instagram correction removes viewing acceleration caused by overdue engagement targets. Across 30 seeded three-minute sessions with missing controls and overdue nonzero targets, the tests each completed a 30–60-second video and bounded consecutive quick skips to two. Short clips, loop/end, buffering, paused/stalled playback, changed media, Stop and keyword/session deadlines have focused checks. TikTok's viewing policy is unchanged.

A hidden local browser fixture used the current production session engine and Instagram DOM reader with a generated real 14-second video. Its only substitutions were local post/search navigation, an Instagram-shaped origin and disabled engagement actions:

- Loop mode: selected posts stayed open for approximately 14.08 seconds and advanced only after actual video loops. The 60-second session ended at 60.005 seconds.
- End mode: an actual video-ended event at position 14 seconds preceded navigation. Pausing a later selected full watch at position 13.409 seconds recovered after approximately 8.1 seconds with no loop or end recorded, then completed subsequent playback and the session deadline.
- Stop during another selected full watch returned stopped immediately at position 6.893 seconds, without an end/loop or further post advance.

This verifies real browser playback behavior, not current live Instagram selector compatibility or installed extension transport. The browser's installed copy remains 0.6.49; publishing 0.6.50 does not modify an unpacked local installation. No additional download or user-run test is requested.

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

## installed 0.6.48 live tests, September 19

Setup confirmed installed 0.6.48, signed-in TikTok @ollymode. The user explicitly requested testing with TikTok selected. Saved settings were five minutes, personal brand, targets 0/0/0. No comments were drafted or posted; specific comment authorization was requested but not received.

- Two-minute 1 like / 1 follow / 0 comment session at approximately 17:06-17:09 UTC completed normally with eight advances, zero confirmed likes/follows and one unconfirmed like. TikTok remained visible and playing. The like attempt was on @salemkinging/video/7662645033958526215. Fresh navigation afterward showed the primary 61.6K-like button with aria-pressed=false. The counter correctly stayed zero. No follow was attempted within this run.
- A three-minute follow-only session started at approximately 17:10 UTC. It attempted @miarosemcgrath/video/7680098183468322070 and reported one unconfirmed follow. The test was deliberately stopped with 1:42 remaining after four advances. Start returned, settings became editable and the session stayed stopped. Fresh navigation to @miarosemcgrath showed the specific profile button 'Follow Mia McGrath | Frugal Chic®', so the follow did not persist.
- An ordinary UI comparison, with the extension session stopped, used the previously unliked @ririalicex/video/7634626986060680470. One click made its 78.3K-like button aria-pressed=true, then it reverted to false within about a minute before reload and remained false after reload. No second click or follow retry was performed. No visible error alert explained the rollback. This establishes failure through the ordinary control too, not its underlying cause or behavior on other accounts.
- Original five-minute/zero-target settings were restored, and TikTok returned to its feed. No Instagram session was started.

## 0.6.49 comment recovery and remaining verification

Carson's supplied report showed 74 minutes, 96 advances, two confirmed likes, 118 unconfirmed likes, 60 unconfirmed follows and zero comments. His pictured hashtag-only caption is intentionally ineligible for generated comments; the report alone does not identify the cause of the action failures.

A separate reproducible bug reserved each generated reply even when the adapter definitively skipped it without submission or a remaining draft. With four available personal-brand replies, four initial skips prevented further attempts throughout a simulated 74-minute session. Release0.6.49 removes only those unused reservations. Same-post guards, submitted/uncertain comments, retained drafts and interrupted outcomes remain protected. Regression tests reproduce the original failure on both platforms and verify continued eligible attempts after the correction.

Installed0.6.48 browsing, timer, Stop, tab visibility and truthful unconfirmed counts passed; durable likes/follows failed. Installed0.6.49 comment recovery and the live comment counter remain unverified. Do not call the extension fully functional or attribute the rollbacks to one person's computer.

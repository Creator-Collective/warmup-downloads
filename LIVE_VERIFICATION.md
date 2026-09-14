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

## remaining verification

No signed-in live run of 0.6.39 has been performed. The latest user instructions prohibit Chrome debugging/control unless explicitly reauthorized; no Chrome inspection or automation was performed during this continuation. A full installed session must still demonstrate a photo transition, confirmed like and follow, a newly visible own comment, and normal timer completion. Do not mark TikTok ready based only on elapsed time or fixtures. Do not count an attempted or uncertain comment as posted.

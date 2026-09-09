# Chrome Web Store submission

Status: package prepared; not submitted or approved. Complete browser installation and fixture verification before submitting. A developer account, registration payment, policy attestations and final submission must be completed by the account owner.

Name: Creator Collective Warm-up
Summary: Run a timed niche browsing session on Instagram or TikTok, with limits and activity you control.
Single purpose: User-started, timed niche browsing sessions in a selected Instagram or TikTok tab.
Homepage: https://creator-collective-warmup.vercel.app/
Privacy policy: https://creator-collective-warmup.vercel.app/privacy.html
Support: https://github.com/Creator-Collective/warmup-downloads/issues

Description:
Choose niche keywords, a session duration, platform, and optional engagement limits on your Creator Collective dashboard. Select an Instagram or TikTok tab and start. The toolbar icon opens a side panel with settings and live activity beside the selected platform. A background session tab keeps the timer alive. Stop at any time.

The panel displays automatic like, follow and comment limits based on session length and pacing. Each amount is directly editable; 0 disables the action. Explicitly saved zero limits remain zero. Instagram comments quote a short sentence from a matching visible caption; TikTok comments are disabled until live controls are verified. The extension does not interpret video content. English Instagram and TikTok controls are currently supported. Limits are maximums, not guaranteed results. No account-safety or recommendation outcome is promised.

Permissions justification:
- sidePanel: display the session controls and activity alongside the selected platform when the user clicks the extension icon.
- scripting: execute packaged DOM observation and interaction functions in the platform tab selected by the user.
- storage: retain session state locally and stop duplicate concurrent sessions; no cloud synchronization.
- Instagram host access: inspect visible posts, scroll and operate exact visible controls in the selected tab.
- TikTok host access: inspect visible videos, scroll and operate exact visible like/follow controls in the selected tab.
- dashboard content script: connect only the exact Creator Collective warm-up origin to the extension. Other websites and iframes cannot use the bridge.

Data disclosures to review accurately in the store form:
Website content is processed locally for matching and interaction verification. Settings and session state remain in the browser. No remote code, analytics, cookie APIs, or data-sale features. Account creation is paused in 0.6.14. The release no longer exposes signup controls, accepts new signup credentials or accesses the email service. Earlier active signup jobs are stopped and their temporary passwords cleared. Previous local mailbox history and access keys are retained; earlier server email records are not deleted. Do not claim the extension never handles website content.

Upload chrome-web-store-0.6.14.zip. Add store screenshots of the actual dashboard and running session only after browser verification. Store review may require changes; do not represent this as approved.

Version 0.6.14 keeps the higher limits and makes likes pace toward the visible session goal sooner instead of waiting on random action selection. It still watches videos between actions and avoids liking every video. TikTok comments stay off. Signup source and regression coverage remain shelved for future work, with a disabled bundled feature flag. No live high-engagement session has been run on this exact release; retain the existing beta and store-review caveats.

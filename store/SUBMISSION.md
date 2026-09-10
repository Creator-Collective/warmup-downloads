# Chrome Web Store submission

Status: package prepared; not submitted or approved. Complete browser installation and fixture verification before submitting. A developer account, registration payment, policy attestations and final submission must be completed by the account owner.

Name: Creator Collective Warm-up
Summary: Run a timed niche browsing session on Instagram or TikTok, with targets and activity you control.
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
- Native account email service host access: prepare owned signup mailboxes, retrieve fresh email codes and save confirmed usernames.
- SMSPool host access: connect the user’s own provider key, list and purchase extendable rentals, inspect rental status and retrieve messages for the chosen signup.
- dashboard content script: connect only the exact Creator Collective warm-up origin to the extension. Other websites and iframes cannot use the bridge.

Data disclosures to review accurately in the store form:
Website content is processed locally for matching and interaction verification. Settings and session state remain in the browser. No remote code, analytics, cookie APIs, or data-sale features. Account creation is available in the packaged side panel. User signup passwords and a user-owned SMSPool key remain in trusted session storage. Persistent local recovery includes generated email, username, birthday, mailbox capability, rental receipt/phone/expiry and consumed message identifiers. The existing native email backend receives mailbox operations; SMSPool receives authenticated rental and message requests. Platform signup fields receive only the corresponding account data. Provider keys are never sent to the website or injected pages. Security checks remain manual. Do not claim the extension never handles website content.

Upload chrome-web-store-0.6.26.zip. Add store screenshots of the actual dashboard and running session only after browser verification. Store review may require changes; do not represent this as approved.

Version 0.6.26 restores account creation and adds user-owned SMSPool monthly rentals for recognized signup phone forms. Phone-number receipts, expiry and recovery state remain local; the provider credential is session-only. Purchase intent and code submission are recorded before action to prevent duplicates after interruption. Country/price options reflect the current provider catalog. Unknown forms, unsupported country pickers and security checkpoints pause. Existing warm-up activity and engagement behavior remain unchanged. Real paid rentals and live platform completion remain unverified; fixture success must not be represented as live signup. See work_log.txt for validation and release evidence.

# Chrome Web Store submission

Status: package prepared; not submitted or approved. Complete browser installation and fixture verification before submitting. A developer account, registration payment, policy attestations and final submission must be completed by the account owner.

Name: Creator Collective Warm-up
Summary: Run a timed niche browsing session on Instagram, with limits and activity you control.
Single purpose: User-started, timed niche browsing sessions in a selected Instagram tab.
Homepage: https://creator-collective-warmup.vercel.app/
Privacy policy: https://creator-collective-warmup.vercel.app/privacy.html
Support: https://github.com/Creator-Collective/warmup-downloads/issues

Description:
Choose niche keywords, a session duration, and optional engagement limits on your Creator Collective dashboard. Select an Instagram tab and start. The toolbar icon opens a side panel with settings and live activity beside Instagram. A background session tab keeps the timer alive. Stop at any time.

Comments are off by default. Enabled comments quote a short sentence from a matching visible caption; the extension does not interpret video content. English Instagram controls are currently supported. Limits are maximums, not guaranteed results. No account-safety or recommendation outcome is promised.

Permissions justification:
- sidePanel: display the session controls and activity alongside Instagram when the user clicks the extension icon.
- scripting: execute packaged DOM observation and interaction functions in the Instagram tab selected by the user.
- storage: retain session state locally and stop duplicate concurrent sessions; no cloud synchronization.
- Instagram host access: inspect visible posts, scroll and operate exact visible controls in the selected tab.
- dashboard content script: connect only the exact Creator Collective warm-up origin to the extension. Other websites and iframes cannot use the bridge.

Data disclosures to review accurately in the store form:
Website content is processed locally for matching and interaction verification. Settings and session state remain in the browser. No remote code, analytics, cookie APIs, or data-sale features. Optional signup handles a new-account password temporarily in extension session storage and fills it into the selected Instagram/TikTok signup form; it never reads existing platform passwords. The selected student dashboard supplies the profile name, owned account aliases and fresh verification code; confirmed usernames are saved back there. Dashboard auth cookies/tokens are never exported. Do not claim the extension never handles website content.

Upload chrome-web-store-0.5.0.zip. Add store screenshots of the actual dashboard and running session only after browser verification. Store review may require changes; do not represent this as approved.

Signup additions require disclosure of TikTok and student-dashboard host access. Version 0.5.0 remains unreleased and not live-verified; do not submit store screenshots or claims of completed automatic signup until verified.

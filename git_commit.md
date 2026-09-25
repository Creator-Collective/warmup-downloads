prepare a separate tiktok test build with instagram unchanged

misc:
- pin instagram behavior with golden goals, runner and panel tests before any change
- read allowed platforms per build from features.js instead of instagram-only gates
- bring the tiktok engine to instagram parity on tiktok-only paths, including six-minute keyword windows
- add numbers-only test tools (fresh-page outcome codes, page check, copyable report) to the test build only
- add a separate tiktok test packager with a fixed id, tiktok-only hosts and a tester protocol
- add a 40 minute tiktok efficiency simulation against the instagram baseline
- package extension 0.6.58 and update install and release notes

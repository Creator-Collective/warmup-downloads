fix: start a new warm-up session right after one finishes

misc:
- find the old session tab with chrome.runtime.getContexts, since chrome hides tab urls without the tabs permission
- stop blocking a new session when the old session tab has no live page
- make test harnesses hide non-platform tab urls like real chrome and add regression tests
- package extension 0.6.59 and update install and release notes

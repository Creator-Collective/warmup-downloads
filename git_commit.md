fix: say why a warm-up session fell short of its targets

a student set 10 follows for 20 minutes and got 2 with nothing to show why:
the activity list keeps 12 lines and skip messages are throttled. a sim of
her settings with real page loads and videos reaches 10/10 follows whenever
posts show a follow button, so her results offered almost nothing to follow.

misc:
- count, once per post and action, the first reason the action wasn't possible: no button, account already followed, off-niche, comment skip reasons
- write one "why targets fell short" activity line when time runs out, including when the runner timer ends the last pause
- keep the counts in the session checkpoint so resume carries them, and drop invalid counts without blocking resume
- no change to pacing, eligibility, clicks or confirmation
- package extension 0.6.60 and update install and release notes

fix: never comment twice on the same instagram post

a student found the same comment from her account twice on one reel, a
week apart. each session only remembered the posts it commented on itself,
so a later session on the same keywords could comment on the same reel again.

misc:
- keep commented post ids for six months (max 5000, no comment text) in local storage, saved with every checkpoint
- hand the list to each new session; those posts never get another comment
- skip posts that already show a comment from the signed-in account, covering older comments and other devices
- end-of-session summary names "posts already had your comment" when that is why comments fell short
- storage failures never block a session
- privacy page mentions the commented-post list
- package extension 0.6.62 and update install and release notes

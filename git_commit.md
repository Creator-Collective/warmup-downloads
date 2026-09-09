fix interrupted warm-up sessions and active controls

reliability:
- retry completion status and recover stopped runners without replaying actions
- keep stop usable after lost acknowledgements and reject stale session updates
- show the active plan and target while preserving saved next-session drafts
- recognize like controls on saved posts

misc:
- publish version 0.6.11 with focused recovery and observer regressions

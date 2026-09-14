fix tiktok photo author detection beside comment composer

misc:
- exclude signed-in composer avatars from primary photo author checks
- preserve real conflicting authors and one-time comment identity checks
- cover observed photo and video composer layouts with regression fixtures
- package 0.6.39 and record incomplete live comment verification

verification:
- 424 automated checks pass
- both 30-file extension archives match source

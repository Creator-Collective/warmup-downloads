fix tiktok session recovery and engagement verification

misc:
- recover promptly from no-action skips without retrying submitted actions
- preserve comment ownership through unrelated row changes and reject late duplicates
- require fresh matched-post evidence before counting tiktok comments
- bound follow and comment verification waits, cancellation and owned-tab cleanup
- require explicit follow controls and normalize equivalent niche phrases
- retain private test identifier and document observed live limits; leave public archives unchanged

validation:
- 91 runner, 110 tiktok observer, 74 session and 6 real editor checks pass
- code, javascript, react and security reviews cover the source and fixture changes
- live browsing and like persisted; one comment appeared later; follows remain unretained
- draft only; final installed-source acceptance and release packaging remain open

add student dashboard warmup version detection

misc:
- release 0.6.33 with an isolated read-only student dashboard version bridge
- generate current release metadata from validated versioned notes
- refresh setup instructions and package both downloads from source
security:
- require exact student origins, top frame, same source and a scoped nonce
- keep the privileged warmup bridge unchanged

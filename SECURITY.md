# Security policy

## Supported versions

Security fixes are applied to the latest released version of Flowmark.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use GitHub's
**Security → Report a vulnerability** flow to submit a private report with:

- the affected Flowmark version and platform;
- reproduction steps or a proof of concept;
- the expected security impact;
- any suggested mitigation.

You should receive an acknowledgement within seven days. The maintainers will
coordinate validation, a fix, and disclosure through the private report.

## Security model

Flowmark is a local application:

- the HTTP server binds only to `127.0.0.1`;
- the embedded server rejects non-loopback Host headers and cross-origin
  requests;
- no task content is sent to a remote service by Flowmark;
- the workspace files are authoritative;
- `.flowmark/` and the global session registry are disposable runtime state.

Anyone who can edit a workspace's files can change its tasks and automation
rules. Treat untrusted workspaces as untrusted input, review rule files, and
keep normal filesystem permissions on sensitive task directories.

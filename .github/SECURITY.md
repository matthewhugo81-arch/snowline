# Snowline security and recovery

## Scope

These safeguards cover both the location forecast comparison and UK model maps.
Keep their existing website behaviour, GitHub Pages hosting, data feeds, model
schedules and Cloudflare services intact. Repository privacy and paid services
are separate owner decisions, not routine security maintenance.

## Source protection

The main branch is protected against deletion and force pushes. Ordinary
fast-forward updates remain allowed; no extra review, signature or status-check
requirement was introduced. Restrict this protection to main. Do not apply it
indiscriminately to generated data or recovery branches.

CODEOWNERS routes review requests to the owner; it is not an additional access
control. Local credential filenames are ignored by Git. Ignore rules do not
remove files already committed and can be overridden with a forced addition.
Never place a private service token in browser code or a public repository.

RIGHTS.md records original-material reuse expectations and third-party exceptions.
The source and browser application remain public; these controls do not hide it.

## Reporting a suspected vulnerability

Use this repository's Security tab and private vulnerability reporting when
available. Do not include credentials, private logs or exploitable details in a
public issue. If private reporting is unavailable, arrange a private channel with
the repository owner before sending sensitive details.

## Recovery

The owner keeps dated source ZIPs, Git bundles, development documentation and
checksums outside this repository. Preserve an existing backup before taking a
new one. Verify archive contents and restore into a new folder before using a
backup. Hosted secrets, Cloudflare state and GitHub account settings need their
own recovery arrangements and are deliberately not included in source archives.

Restore files with a reviewed forward commit rather than resetting or force
pushing main. Do not replace current weather data with an old snapshot merely
to restore website code. The existing README, docs and workflow files remain the
operating reference. No backup operation should dispatch model-processing jobs,
change provider timestamps or alter live publication.

## Limits

Account access controls, credential scanning and backups reduce different risks.
None guarantees that all vulnerabilities or exposed credentials will be detected.
If a real credential is exposed, revoke or rotate it at its provider and inspect
the affected history; deleting the visible file alone is insufficient.

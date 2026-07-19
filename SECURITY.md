# Security Policy

Praxis installs a methodology layer — agent instructions, permission
configuration, and plugin declarations — into consumer repositories. Because
that content can influence what an AI coding agent is permitted or induced to
do in a target project, we treat content-integrity issues as security
vulnerabilities, not just conventional memory-safety or injection bugs. In
scope, for example: a way to make Praxis write outside its intended target
root, or a way for declarative content (instructions, permission policy,
plugin metadata) to escalate into unintended executable authority.

## Supported Versions

Praxis is pre-1.0 and moves quickly. Only the latest published 0.x release on
npm receives security fixes.

| Version              | Supported |
| -------------------- | --------- |
| Latest 0.x release   | ✅        |
| Earlier 0.x releases | ❌        |

## Reporting a Vulnerability

**Do not open a public issue for a suspected vulnerability.**

The preferred channel is GitHub's private vulnerability reporting: use
"Report a vulnerability" under this repository's **Security** tab. (Private
reporting may not be enabled until the repository is public; the maintainer
enables it as part of the public launch.)

If that channel is unavailable, email **tony@pragmaticlabs.ai** with details
sufficient to reproduce the issue.

## Response Targets

- **Acknowledgement:** within 3 business days of receipt.
- **Initial assessment:** within 14 days, including whether the report is
  confirmed as a vulnerability and its expected severity.
- **Coordinated disclosure:** we ask reporters to allow up to 90 days from
  acknowledgement before any public disclosure, to give time for a fix and
  release. Fixes are announced via a GitHub security advisory and a patched
  npm release.

Thank you for helping keep Praxis and the projects it's installed into safe.

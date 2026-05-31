# Security Policy

CodeGrid is a local-first, open-source desktop app published by ZipLyne LLC. It collects no data and
operates no servers — see the full model at <https://codegrid.app/security>.

## Reporting a vulnerability

Please report security issues **privately** so we can fix them before disclosure:

- Email **admin@codegrid.dev** with details and reproduction steps, **or**
- Open a [private security advisory](https://github.com/ZipLyne-Agency/CodeGrid-Claude-Code-Terminal/security/advisories/new) on this repository.

Please do **not** open a public issue for a suspected vulnerability.

## What to expect

- We aim to acknowledge your report within **3 business days**.
- We'll keep you updated as we investigate and work on a fix.
- We practice coordinated disclosure: please allow a reasonable window for a fix to ship before
  publishing details. We're happy to credit you.

## Scope

In scope: the CodeGrid desktop application and this repository.

Out of scope: the third-party AI agent CLIs CodeGrid launches (Claude Code, Codex, Gemini, Cursor) and
their providers — report those to the respective vendors.

## Supported versions

CodeGrid ships from `main`; security fixes target the latest release. Please reproduce on the most
recent version before reporting.

# Security policy

Browserjack can control authenticated browser sessions through OpenAI's locally installed browser runtime. Treat every report that touches session integrity, credential exposure, sandbox scope, or signature verification as security-relevant.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](../../security/advisories/new) for this repository. Do not open a public issue for exploitable problems.

You can expect an initial response within 7 days. Please include the Browserjack version, the ChatGPT.app version, and redacted `browserjack doctor --json` output.

## Scope

In scope:

- Bypass of the fail-closed compatibility manifest
- Bypass of code-signature or Team ID verification
- Escape from the documented sandbox write scope
- Leakage of browser content, cookies, tokens, or form data through Browserjack's process chain, stdout, or stderr
- Tampering with the installed release, shim, or MCP registration

Out of scope:

- Vulnerabilities in OpenAI's ChatGPT.app, extension, or native host (report to OpenAI)
- Vulnerabilities in Claude Code (report to Anthropic)
- Attacks requiring an already-compromised local user account

## Supported versions

Only the latest published release receives security fixes. The compatibility manifest intentionally rejects unknown ChatGPT.app builds; do not patch around it.

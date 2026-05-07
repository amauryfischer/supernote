# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.x (latest minor) | Yes |
| Older minor releases | No — please upgrade |

Once Supernote reaches `1.0.0`, the support table will be updated to cover the last two minor releases.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Send a report by email to **security@numerisk.fr** with:

1. A description of the vulnerability and its potential impact
2. Steps to reproduce (proof-of-concept if possible)
3. The Supernote version and OS where you observed the issue
4. Your preferred way to be credited (name / pseudonym / anonymous)

### What to expect

- **Acknowledgement** within 48 hours on business days
- **Status update** within 7 days (confirmed, needs more info, or not a vulnerability)
- **Fix or mitigation** within 90 days for confirmed issues, sooner when possible
- A **CVE** will be requested for confirmed vulnerabilities with significant impact
- You will be credited in the release notes unless you prefer anonymity

### Scope

In scope:
- Code execution / privilege escalation via Electron or Node.js APIs
- Path traversal or arbitrary file read/write via IPC handlers
- SQLite injection via user-supplied data
- Information disclosure of vault data to external parties

Out of scope:
- Vulnerabilities in third-party Electron/Node.js/Chromium that are already tracked upstream
- Social-engineering attacks
- Issues requiring physical access to an unlocked machine

## Responsible disclosure

We follow [coordinated vulnerability disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). We ask that you give us a reasonable window to fix the issue before public disclosure.

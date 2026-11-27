# Security Policy & Official Distribution Channels

## Official Distribution Channels (ONLY Trusted Sources)

KuroCat is developed and maintained exclusively by **Qianyi (`@qianyiai`)**. Only the following distribution channels are official:

1. **Official Website & Verified CDN**: `https://kurocat.org/` (Downloads & SHA-256: `https://kurocat.org/download/`)
2. **Official GitHub Repository & Releases**: `https://github.com/qianyiai/KuroCat`
3. **Official macOS Homebrew Tap**: `https://github.com/qianyiai/homebrew-tap` (`brew install --cask qianyiai/tap/kurocat`)

Every official release publishes 64-character **SHA-256 checksums** on both GitHub Releases and `https://kurocat.org/download/`.

---

## Active Security Advisory: Impersonation & Suspected Malware Site (`kurocat.net`)

**Date Published**: 2026-11-26  
**Advisory URL**: https://kurocat.org/en/security/ (中文: https://kurocat.org/security/)

We have identified an unaffiliated impersonation website (**`kurocat.net`**, registered 2026-11-24 via NameSilo, proxied via Cloudflare) spoofing the official KuroCat website and distributing an unauthorized, heavily padded Windows archive directly from its own server while linking other platforms to our real GitHub repository as a decoy.

### Indicators of Compromise (IoCs)

- **Fake Website**: `https://kurocat.net/` · `https://kurocat.net/downloads.html`
- **Unauthorized Payload URL**: `https://kurocat.net/KuroCat.v5.1.0.zip`
- **Archive Size**: `67,371,456` bytes (`64.25 MB`)
- **Archive SHA-256**: `19ad10c48a7448584f1d00aa086f52b38231bacd659f04e83d3cefc60209796d`
- **Suspicious Contents Inside Archive**:
  - `KuroCat.v5.1.0/KuroCat.exe` (`37,666,577` bytes / `35.92 MB`, CRC32 `0e67ba17`) — **NOT an official KuroCat binary** (official `v5.1.0` Windows 10/11 NSIS installer is `KuroCat-5.1.0-x64-setup.exe`, `2,265,943` bytes / `2.16 MB`, SHA-256 `c9d49aeab4b6433cfd2ad10e6032e8b47819f50bbba39dc7133c021d50a01f9f`; official `v5.1.2` installer is `2.23 MB`).
  - `KuroCat.v5.1.0/bin/resources.pak` (`50,331,648` bytes = exact `48.00 MiB`, STORED uncompressed) — **does not exist in KuroCat**; classic scanner/AV size-evasion padding.
  - `KuroCat.v5.1.0/bin/versions.dat` (`2,097,152` bytes = exact `2.00 MiB`, STORED uncompressed) — **does not exist in KuroCat**.
  - `KuroCat.v5.1.0/config.ini`, `docs/usage.txt` — **do not exist in KuroCat**.

### If You Downloaded or Executed Files from `kurocat.net`

1. **Disconnect the affected Windows PC from the internet** immediately.
2. **Delete the downloaded ZIP and extracted `KuroCat.v5.1.0` folder**.
3. Run a full offline/deep scan with **Windows Defender (Microsoft Defender Offline)** and a reputable second-opinion scanner (e.g., Malwarebytes).
4. **From a separate, clean device**, rotate passwords, sign out active browser sessions, and revoke API tokens / SSH keys / crypto wallets that were stored in browsers or locally on the affected machine.
5. Reinstall KuroCat **only** from `https://kurocat.org/download/` or `https://github.com/qianyiai/KuroCat/releases` and verify the SHA-256 hash before running.

## Reporting Security Issues or Impersonation Sites

Please report vulnerabilities or fake distribution domains via [GitHub Issues](https://github.com/qianyiai/KuroCat/issues) or GitHub Private Vulnerability Reporting on `qianyiai/KuroCat`.

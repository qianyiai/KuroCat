#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

export const RELEASE_VERSION = 'v5.1.3';
export const RELEASE_VER_NUM = '5.1.3';

export const VERIFIED_ASSETS = [
  {
    key: 'win64',
    platform: {
      zh: 'Windows 10 / 11 (x64)',
      en: 'Windows 10 / 11 (x64)',
      ja: 'Windows 10 / 11 (x64)',
      ko: 'Windows 10 / 11 (x64)',
      es: 'Windows 10 / 11 (x64)',
      pt: 'Windows 10 / 11 (x64)',
      ru: 'Windows 10 / 11 (x64)',
      de: 'Windows 10 / 11 (x64)',
    },
    desc: {
      zh: '推荐安装版 · 内置 65% / 108 键切换与 App 内自动更新',
      en: 'Recommended NSIS installer · 65%/108-key + in-app auto-updater',
      ja: '推奨インストーラー · 65%/108 キー切替＆自動更新内蔵',
      ko: '권장 설치판 · 65%/108키 전환 및 앱 내 자동 업데이트 내장',
      es: 'Instalador NSIS recomendado · cambio 65%/108 teclas + actualización automática',
      pt: 'Instalador NSIS recomendado · troca 65%/108 teclas + atualização automática',
      ru: 'Рекомендуемый установщик NSIS · раскладки 65%/108 клавиш и автообновление',
      de: 'Empfohlener NSIS-Installer · 65%/108-Tasten-Wechsel & Auto-Update in der App',
    },
    file: 'KuroCat-5.1.3-x64-setup.exe',
    size: '2.40 MB',
    sha256: 'aea87e3e7ee0cc8deaafcac2ed9d69c0587d41797f441a2f842724a4e1bb47df',
  },
  {
    key: 'macos',
    platform: {
      zh: 'macOS 10.15+ (Apple Silicon & Intel)',
      en: 'macOS 10.15+ (Apple Silicon & Intel)',
      ja: 'macOS 10.15+ (M1–M4 & Intel)',
      ko: 'macOS 10.15+ (Apple Silicon & Intel)',
      es: 'macOS 10.15+ (Apple Silicon e Intel)',
      pt: 'macOS 10.15+ (Apple Silicon e Intel)',
      ru: 'macOS 10.15+ (Apple Silicon и Intel)',
      de: 'macOS 10.15+ (Apple Silicon & Intel)',
    },
    desc: {
      zh: '通用 DMG 镜像 · 也可通过 brew install --cask qianyiai/tap/kurocat 安装',
      en: 'Universal DMG · or install via brew install --cask qianyiai/tap/kurocat',
      ja: 'Universal DMG · Homebrew 1 行インストール対応',
      ko: '유니버설 DMG · Homebrew 한 줄 설치 지원',
      es: 'DMG universal · o instala con brew install --cask qianyiai/tap/kurocat',
      pt: 'DMG universal · ou instale com brew install --cask qianyiai/tap/kurocat',
      ru: 'Универсальный DMG · или установка через brew install --cask qianyiai/tap/kurocat',
      de: 'Universal-DMG · oder per brew install --cask qianyiai/tap/kurocat installieren',
    },
    file: 'KuroCat-v5.1.3-macos-universal.dmg',
    size: '6.57 MB',
    sha256: '2e42bb1f2701725a93b1e074bbb6694b6471821a78c341e0e8b216efcec545a9',
  },
  {
    key: 'win7',
    platform: {
      zh: 'Windows 7 SP1 (64 位离线兼容包)',
      en: 'Windows 7 SP1 (x64 Portable)',
      ja: 'Windows 7 SP1 (64bit ポータブル)',
      ko: 'Windows 7 SP1 (64비트 포터블)',
      es: 'Windows 7 SP1 (x64 portátil)',
      pt: 'Windows 7 SP1 (x64 portátil)',
      ru: 'Windows 7 SP1 (x64 портативная)',
      de: 'Windows 7 SP1 (x64 Portabel)',
    },
    desc: {
      zh: '内置离线 WebView2 109 内核 · 无 Aero 亦无白框',
      en: 'Bundled offline WebView2 109 · native per-pixel transparency',
      ja: 'オフライン WebView2 109 同梱 · Aero 不要の透過描画',
      ko: '오프라인 WebView2 109 내장 · Aero 없이도 완벽한 투명 렌더링',
      es: 'Incluye WebView2 109 sin conexión · transparencia nativa por píxel sin Aero',
      pt: 'Inclui WebView2 109 offline · transparência nativa por pixel sem precisar do Aero',
      ru: 'Встроенный офлайн WebView2 109 · нативная попиксельная прозрачность без Aero',
      de: 'Integriertes Offline-WebView2 109 · native Pixel-Transparenz auch ohne Aero',
    },
    file: 'KuroCat-v5.1.3-win7-x64-portable.zip',
    size: '179.3 MB',
    sha256: 'af9848ad0d108cd6e97f735f883e0eee7e8326fa298137de7e2d75832ca295f2',
  },
  {
    key: 'linux-x64-deb',
    platform: {
      zh: 'Linux x86_64 (.deb)',
      en: 'Linux x86_64 (.deb)',
      ja: 'Linux x86_64 (.deb)',
      ko: 'Linux x86_64 (.deb)',
      es: 'Linux x86_64 (.deb)',
      pt: 'Linux x86_64 (.deb)',
      ru: 'Linux x86_64 (.deb)',
      de: 'Linux x86_64 (.deb)',
    },
    desc: {
      zh: 'Ubuntu 22.04+ / Debian 12+ / 银河麒麟 V11+（glibc >= 2.34）',
      en: 'Ubuntu 22.04+ / Debian 12+ / KylinOS V11+ (glibc >= 2.34)',
      ja: 'Ubuntu 22.04+ / Debian 12+ / KylinOS V11+ (glibc >= 2.34)',
      ko: 'Ubuntu 22.04+ / Debian 12+ / KylinOS V11+ (glibc >= 2.34)',
      es: 'Ubuntu 22.04+ / Debian 12+ / KylinOS V11+ (glibc >= 2.34)',
      pt: 'Ubuntu 22.04+ / Debian 12+ / KylinOS V11+ (glibc >= 2.34)',
      ru: 'Ubuntu 22.04+ / Debian 12+ / KylinOS V11+ (glibc >= 2.34)',
      de: 'Ubuntu 22.04+ / Debian 12+ / KylinOS V11+ (glibc >= 2.34)',
    },
    file: 'KuroCat-v5.1.3-linux-amd64.deb',
    size: '2.66 MB',
    sha256: '715eff451685e977a444e70fd8032e7599facfeb86c7a47c3764332d4dd4979f',
  },
  {
    key: 'linux-arm64-deb',
    platform: {
      zh: 'Linux ARM64 (.deb)',
      en: 'Linux ARM64 (.deb)',
      ja: 'Linux ARM64 (.deb)',
      ko: 'Linux ARM64 (.deb)',
      es: 'Linux ARM64 (.deb)',
      pt: 'Linux ARM64 (.deb)',
      ru: 'Linux ARM64 (.deb)',
      de: 'Linux ARM64 (.deb)',
    },
    desc: {
      zh: '飞腾 / 鲲鹏 / 银河麒麟 ARM64 / 树莓派',
      en: 'ARM64 / Raspberry Pi / KylinOS ARM64',
      ja: 'ARM64 / Raspberry Pi 向け .deb パッケージ',
      ko: 'ARM64 / 라즈베리 파이용 .deb 패키지',
      es: 'Paquete .deb para ARM64 / Raspberry Pi / KylinOS ARM64',
      pt: 'Pacote .deb para ARM64 / Raspberry Pi / KylinOS ARM64',
      ru: 'Пакет .deb для ARM64 / Raspberry Pi / KylinOS ARM64',
      de: '.deb-Paket für ARM64 / Raspberry Pi / KylinOS ARM64',
    },
    file: 'KuroCat-v5.1.3-linux-arm64.deb',
    size: '2.62 MB',
    sha256: '148b2cf1dd09785a2d4f5e5739ff2f0d2279b4bb89010d30ebe9c296d1a43a37',
  },
  {
    key: 'linux-x64-appimage',
    platform: {
      zh: 'Linux x86_64 (.AppImage)',
      en: 'Linux x86_64 (.AppImage)',
      ja: 'Linux x86_64 (.AppImage)',
      ko: 'Linux x86_64 (.AppImage)',
      es: 'Linux x86_64 (.AppImage)',
      pt: 'Linux x86_64 (.AppImage)',
      ru: 'Linux x86_64 (.AppImage)',
      de: 'Linux x86_64 (.AppImage)',
    },
    desc: {
      zh: '免安装绿色便携版 · chmod +x 后直接运行',
      en: 'Portable AppImage · chmod +x and run without root',
      ja: 'インストール不要ポータブル版 · chmod +x で即起動',
      ko: '무설치 포터블 버전 · chmod +x 후 바로 실행',
      es: 'AppImage portátil · ejecuta tras chmod +x sin permisos root',
      pt: 'AppImage portátil · execute após chmod +x sem precisar de root',
      ru: 'Портативный AppImage · выполните chmod +x и запускайте без root',
      de: 'Portables AppImage · per chmod +x ausführbar machen und ohne Root starten',
    },
    file: 'KuroCat-v5.1.3-linux-amd64.AppImage',
    size: '77.8 MB',
    sha256: '629051627c86415dd3ce1fbd530323cff4779cbb3ed9b0ab9797dab14cf3339d',
  },
  {
    key: 'linux-arm64-appimage',
    platform: {
      zh: 'Linux ARM64 (.AppImage)',
      en: 'Linux ARM64 (.AppImage)',
      ja: 'Linux ARM64 (.AppImage)',
      ko: 'Linux ARM64 (.AppImage)',
      es: 'Linux ARM64 (.AppImage)',
      pt: 'Linux ARM64 (.AppImage)',
      ru: 'Linux ARM64 (.AppImage)',
      de: 'Linux ARM64 (.AppImage)',
    },
    desc: {
      zh: 'ARM64 免安装绿色便携版',
      en: 'Portable ARM64 AppImage',
      ja: 'ARM64 向けポータブル版',
      ko: 'ARM64 포터블 AppImage',
      es: 'AppImage portátil para ARM64',
      pt: 'AppImage portátil para ARM64',
      ru: 'Портативный AppImage для ARM64',
      de: 'Portables ARM64-AppImage',
    },
    file: 'KuroCat-v5.1.3-linux-arm64.AppImage',
    size: '76.0 MB',
    sha256: '7e858187316608c619d4a783435b74163c094daedbaf8e321afc7090b346e072',
  },
  {
    key: 'android',
    platform: {
      zh: 'Android 客户端 (.apk)',
      en: 'Android App (.apk)',
      ja: 'Android アプリ (.apk)',
      ko: 'Android 앱 (.apk)',
      es: 'App de Android (.apk)',
      pt: 'App para Android (.apk)',
      ru: 'Приложение Android (.apk)',
      de: 'Android-App (.apk)',
    },
    desc: {
      zh: '官方签发安装包 · 手机平板触控交互小黑猫',
      en: 'Official Android APK build',
      ja: '公式 Android APK ビルド',
      ko: '공식 Android APK 빌드',
      es: 'Compilación oficial APK para Android',
      pt: 'Compilação oficial APK para Android',
      ru: 'Официальная сборка Android APK',
      de: 'Offizieller Android-APK-Build',
    },
    file: 'KuroCat-v5.1.3-android.apk',
    size: '5.17 MB',
    sha256: '87594264749c3a637b8b1f64aa7adee7e4712e7703fffddfc493be2fd005ab43',
  },
];

const LOCALES = ['zh', 'en', 'ja', 'ko', 'es', 'pt', 'ru', 'de'];
const LOCALE_META = {
  zh: { htmlLang: 'zh-CN', ogLocale: 'zh_CN', prefix: '', siteName: 'KuroCat 官网', shortLabel: '中文', nativeName: '简体中文' },
  en: { htmlLang: 'en', ogLocale: 'en_US', prefix: '/en', siteName: 'KuroCat Official', shortLabel: 'EN', nativeName: 'English' },
  ja: { htmlLang: 'ja', ogLocale: 'ja_JP', prefix: '/ja', siteName: 'KuroCat 公式サイト', shortLabel: '日本語', nativeName: '日本語' },
  ko: { htmlLang: 'ko', ogLocale: 'ko_KR', prefix: '/ko', siteName: 'KuroCat 공식 사이트', shortLabel: '한국어', nativeName: '한국어' },
  es: { htmlLang: 'es', ogLocale: 'es_ES', prefix: '/es', siteName: 'KuroCat Oficial', shortLabel: 'ES', nativeName: 'Español' },
  pt: { htmlLang: 'pt-BR', ogLocale: 'pt_BR', prefix: '/pt', siteName: 'KuroCat Oficial', shortLabel: 'PT', nativeName: 'Português (BR)' },
  ru: { htmlLang: 'ru', ogLocale: 'ru_RU', prefix: '/ru', siteName: 'Официальный сайт KuroCat', shortLabel: 'RU', nativeName: 'Русский' },
  de: { htmlLang: 'de', ogLocale: 'de_DE', prefix: '/de', siteName: 'KuroCat Offiziell', shortLabel: 'DE', nativeName: 'Deutsch' },
};

const NAV_I18N = {
  zh: {
    home: '首页试玩',
    download: '全平台下载',
    vs: 'vs Bongo Cat',
    obs: 'OBS 直播源',
    mcp: 'AI 伴侣 & MCP',
    security: '防伪安全公告',
    github: 'GitHub',
    officialStrip: '🔒 唯一官方渠道：kurocat.org · github.com/qianyiai/KuroCat · qianyiai/homebrew-tap（⚠️ 谨防假冒站 kurocat.net 分发的 64 MB 疑似木马假包）',
    ctaPlay: '打开 3D 在线试玩 →',
    ctaDl: '免费下载最新版 →',
    copied: '已复制 ✓',
    copy: '复制',
    cdnBtn: '官网高速直链',
    ghBtn: 'GitHub 原链',
    footerAuthor: '由 谦一 (Qianyi) 开源维护 · MIT License',
  },
  en: {
    home: '3D Playground',
    download: 'Downloads',
    vs: 'vs Bongo Cat',
    obs: 'OBS Overlay',
    mcp: 'AI & MCP Studio',
    security: 'Security Advisory',
    github: 'GitHub',
    officialStrip: '🔒 Official channels only: kurocat.org · github.com/qianyiai/KuroCat · qianyiai/homebrew-tap (⚠️ WARNING: kurocat.net distributes a fake 64 MB padded ZIP — do NOT run it)',
    ctaPlay: 'Try Live 3D Playground →',
    ctaDl: 'Free Official Download →',
    copied: 'Copied ✓',
    copy: 'Copy',
    cdnBtn: 'Official CDN',
    ghBtn: 'GitHub Release',
    footerAuthor: 'MIT Open Source · Built by Qianyi (@qianyiai)',
  },
  ja: {
    home: '3D 体験',
    download: 'ダウンロード',
    vs: 'vs Bongo Cat',
    obs: 'OBS 透過配信',
    mcp: 'AI & MCP',
    security: '偽サイト警告',
    github: 'GitHub',
    officialStrip: '🔒 公式配布元のみ：kurocat.org · github.com/qianyiai/KuroCat · qianyiai/homebrew-tap（⚠️ 偽サイト kurocat.net の 64 MB 不正 ZIP に注意）',
    ctaPlay: 'ブラウザで 3D 体験する →',
    ctaDl: '最新公式版を無料ダウンロード →',
    copied: 'コピー済 ✓',
    copy: 'コピー',
    cdnBtn: '公式高速ミラー',
    ghBtn: 'GitHub 公式',
    footerAuthor: 'MIT オープンソース · 開発: 謙一 (Qianyi)',
  },
  ko: {
    home: '3D 체험',
    download: '다운로드',
    vs: 'vs Bongo Cat',
    obs: 'OBS 투명 오버레이',
    mcp: 'AI & MCP',
    security: '보안 공지',
    github: 'GitHub',
    officialStrip: '🔒 유일한 공식 채널: kurocat.org · github.com/qianyiai/KuroCat · qianyiai/homebrew-tap (⚠️ 사칭 사이트 kurocat.net의 64 MB 변조 ZIP 주의)',
    ctaPlay: '3D 실시간 체험 열기 →',
    ctaDl: '공식 최신 버전 무료 다운로드 →',
    copied: '복사됨 ✓',
    copy: '복사',
    cdnBtn: '공식 고속 CDN',
    ghBtn: 'GitHub 공식',
    footerAuthor: 'MIT 오픈소스 · 제작: Qianyi (@qianyiai)',
  },
  es: {
    home: 'Prueba 3D',
    download: 'Descargas',
    vs: 'vs Bongo Cat',
    obs: 'Overlay OBS',
    mcp: 'IA y MCP Studio',
    security: 'Aviso de seguridad',
    github: 'GitHub',
    officialStrip: '🔒 Solo canales oficiales: kurocat.org · github.com/qianyiai/KuroCat · qianyiai/homebrew-tap (⚠️ AVISO: kurocat.net distribuye un ZIP falso de 64 MB — NO lo ejecutes)',
    ctaPlay: 'Probar 3D en vivo →',
    ctaDl: 'Descarga oficial gratis →',
    copied: 'Copiado ✓',
    copy: 'Copiar',
    cdnBtn: 'CDN oficial',
    ghBtn: 'GitHub Release',
    footerAuthor: 'Código abierto MIT · Creado por Qianyi (@qianyiai)',
  },
  pt: {
    home: 'Testar em 3D',
    download: 'Downloads',
    vs: 'vs Bongo Cat',
    obs: 'Overlay OBS',
    mcp: 'IA & MCP Studio',
    security: 'Aviso de segurança',
    github: 'GitHub',
    officialStrip: '🔒 Apenas canais oficiais: kurocat.org · github.com/qianyiai/KuroCat · qianyiai/homebrew-tap (⚠️ ALERTA: kurocat.net distribui um ZIP falso de 64 MB — NÃO execute)',
    ctaPlay: 'Testar 3D ao vivo →',
    ctaDl: 'Download oficial grátis →',
    copied: 'Copiado ✓',
    copy: 'Copiar',
    cdnBtn: 'CDN oficial',
    ghBtn: 'GitHub Release',
    footerAuthor: 'Código aberto MIT · Feito por Qianyi (@qianyiai)',
  },
  ru: {
    home: '3D-демо',
    download: 'Скачать',
    vs: 'vs Bongo Cat',
    obs: 'Оверлей OBS',
    mcp: 'ИИ и MCP',
    security: 'Безопасность',
    github: 'GitHub',
    officialStrip: '🔒 Только официальные каналы: kurocat.org · github.com/qianyiai/KuroCat · qianyiai/homebrew-tap (⚠️ ОСТОРОЖНО: фейк-сайт kurocat.net распространяет поддельный ZIP 64 МБ — НЕ запускайте)',
    ctaPlay: 'Открыть 3D-демо →',
    ctaDl: 'Скачать бесплатно →',
    copied: 'Скопировано ✓',
    copy: 'Копировать',
    cdnBtn: 'Официальный CDN',
    ghBtn: 'Релиз GitHub',
    footerAuthor: 'Открытый код MIT · Автор: Qianyi (@qianyiai)',
  },
  de: {
    home: '3D-Demo',
    download: 'Downloads',
    vs: 'vs Bongo Cat',
    obs: 'OBS-Overlay',
    mcp: 'KI & MCP-Studio',
    security: 'Sicherheitshinweis',
    github: 'GitHub',
    officialStrip: '🔒 Nur offizielle Kanäle: kurocat.org · github.com/qianyiai/KuroCat · qianyiai/homebrew-tap (⚠️ WARNUNG: kurocat.net verbreitet ein gefälschtes 64-MB-ZIP — NICHT ausführen)',
    ctaPlay: 'Live-3D-Demo testen →',
    ctaDl: 'Kostenloser Download →',
    copied: 'Kopiert ✓',
    copy: 'Kopieren',
    cdnBtn: 'Offizielles CDN',
    ghBtn: 'GitHub Release',
    footerAuthor: 'MIT Open Source · Entwickelt von Qianyi (@qianyiai)',
  },
};

export const SUBPAGE_SLUGS = ['download', 'vs/bongo-cat', 'obs', 'mcp', 'security'];

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pageUrl(locale, slug) {
  const pref = LOCALE_META[locale].prefix;
  return `https://kurocat.org${pref}/${slug}/`;
}

function pagePath(locale, slug) {
  const pref = LOCALE_META[locale].prefix;
  return `${pref}/${slug}/`;
}

function homePath(locale) {
  return locale === 'zh' ? '/' : `/${locale}/`;
}

const SHARED_CSS = `
:root {
  --bg: #07080c;
  --surface: rgba(255, 255, 255, 0.04);
  --surface-strong: rgba(255, 255, 255, 0.07);
  --border: rgba(255, 255, 255, 0.10);
  --text: #f4f6fb;
  --sub: #a0a8ba;
  --dim: #737b8e;
  --lime: #d4f044;
  --lime-ink: #0a0c06;
  --cyan: #58c7ff;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: radial-gradient(circle at 50% -10%, rgba(212, 240, 68, 0.09), transparent 46%), var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Noto Sans", "PingFang SC", "Hiragino Sans", "Apple SD Gothic Neo", "Microsoft YaHei", system-ui, sans-serif;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; }
code, pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.global-nav {
  position: sticky; top: 0; z-index: 50;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  background: rgba(7, 8, 12, 0.78);
  border-bottom: 1px solid var(--border);
}
.nav-inner {
  max-width: 1100px; margin: 0 auto; padding: 12px 20px;
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
}
.brand {
  display: inline-flex; align-items: center; gap: 8px;
  text-decoration: none; font-weight: 700; font-size: 15px; letter-spacing: -0.01em;
}
.brand img { border-radius: 5px; }
.ver-pill {
  font-size: 11px; font-weight: 700; color: var(--lime);
  background: rgba(212, 240, 68, 0.13); border: 1px solid rgba(212, 240, 68, 0.30);
  padding: 1px 7px; border-radius: 999px;
}
.nav-right { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.nav-links { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--sub); }
.nav-links a { text-decoration: none; transition: color 0.18s; }
.nav-links a:hover, .nav-links a.active { color: var(--text); font-weight: 600; }
.lang-dropdown { position: relative; flex-shrink: 0; }
.lang-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 11px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.065); border: 1px solid rgba(255, 255, 255, 0.14);
  color: var(--text); font-family: inherit; font-size: 12px; font-weight: 600;
  line-height: 1.2; cursor: pointer; white-space: nowrap;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}
.lang-trigger:hover, .lang-dropdown.open .lang-trigger {
  background: rgba(255, 255, 255, 0.11); border-color: rgba(212, 240, 68, 0.45);
}
.lang-globe { color: var(--lime); flex-shrink: 0; }
.lang-caret { color: var(--sub); transition: transform 0.2s ease; flex-shrink: 0; }
.lang-dropdown.open .lang-caret { transform: rotate(180deg); color: var(--lime); }
.lang-menu {
  position: absolute; top: calc(100% + 8px); right: 0; min-width: 184px; padding: 6px;
  border-radius: 16px; background: rgba(14, 15, 20, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.68), 0 0 0 1px rgba(212, 240, 68, 0.06);
  backdrop-filter: saturate(180%) blur(22px); -webkit-backdrop-filter: saturate(180%) blur(22px);
  display: grid; grid-template-columns: 1fr; gap: 2px;
  opacity: 0; visibility: hidden; transform: translateY(-6px) scale(0.98);
  transform-origin: top right; pointer-events: none;
  transition: opacity 0.16s ease, transform 0.18s ease, visibility 0.16s ease;
  z-index: 90;
}
.lang-dropdown.open .lang-menu {
  opacity: 1; visibility: visible; transform: translateY(0) scale(1); pointer-events: auto;
}
.lang-btn {
  display: flex; align-items: center; gap: 9px; text-decoration: none;
  font-size: 12.5px; font-weight: 500; color: var(--sub);
  padding: 7px 10px; border-radius: 10px; line-height: 1.25; white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}
.lang-code {
  display: inline-flex; align-items: center; justify-content: center; min-width: 24px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px; font-weight: 700; letter-spacing: 0.03em;
  padding: 2px 5px; border-radius: 6px;
  background: rgba(255, 255, 255, 0.07); color: var(--sub);
}
.lang-btn:hover { background: rgba(255, 255, 255, 0.08); color: var(--text); }
.lang-btn.active { background: var(--lime); color: var(--lime-ink); font-weight: 700; }
.lang-btn.active .lang-code { background: rgba(10, 12, 6, 0.16); color: var(--lime-ink); }
.wrap { max-width: 1020px; margin: 0 auto; padding: 34px 20px 76px; }
.breadcrumb {
  display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--dim); margin-bottom: 18px;
}
.breadcrumb a { color: var(--sub); text-decoration: none; }
.breadcrumb a:hover { color: var(--lime); }
.hero {
  padding: 28px 30px; border-radius: 24px;
  background: linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025));
  border: 1px solid var(--border); margin-bottom: 24px;
}
.eyebrow {
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--lime); margin-bottom: 10px;
}
h1 {
  margin: 0 0 12px; font-size: clamp(26px, 4vw, 38px); line-height: 1.2; letter-spacing: -0.025em;
}
.lead { margin: 0 0 20px; font-size: 15.5px; color: var(--sub); max-width: 780px; }
.cta-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 18px; border-radius: 999px; text-decoration: none; font-size: 13.5px; font-weight: 650;
  border: 1px solid var(--border); background: var(--surface-strong); color: var(--text);
  transition: transform 0.15s, border-color 0.15s;
}
.btn:hover { transform: translateY(-1px); border-color: rgba(255,255,255,0.28); }
.btn-lime { background: var(--lime); color: var(--lime-ink); border-color: transparent; }
.btn-sm { padding: 6px 12px; font-size: 12px; }
html.official-alert-dismissed .official-bar { display: none; }
.official-bar {
  position: relative;
  margin-top: 18px; padding: 10px 42px 10px 14px; border-radius: 12px;
  background: rgba(212, 240, 68, 0.07); border: 1px solid rgba(212, 240, 68, 0.22);
  font-size: 12.5px; color: #dce89d;
}
.official-bar-close {
  position: absolute; top: 50%; right: 10px; transform: translateY(-50%);
  width: 24px; height: 24px; padding: 0; border-radius: 999px;
  border: 1px solid rgba(212, 240, 68, 0.26); background: rgba(0, 0, 0, 0.25);
  color: #dce89d; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.official-bar-close:hover {
  background: rgba(212, 240, 68, 0.18); border-color: rgba(212, 240, 68, 0.55); color: #ffffff;
}
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 20px; padding: 24px 26px; margin-bottom: 20px;
}
h2 { margin: 0 0 14px; font-size: 21px; letter-spacing: -0.015em; }
h3 { margin: 18px 0 8px; font-size: 15.5px; color: var(--text); }
p { margin: 0 0 12px; color: var(--sub); font-size: 14.5px; }
p strong, li strong { color: var(--text); }
ul, ol { margin: 0 0 14px; padding-left: 20px; color: var(--sub); font-size: 14.5px; }
li { margin-bottom: 6px; }
.table-wrap { overflow-x: auto; margin-top: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { text-align: left; padding: 12px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--sub); font-size: 12px; font-weight: 650; white-space: nowrap; background: rgba(255,255,255,0.02); }
.sha { display: block; font-size: 11px; color: var(--dim); word-break: break-all; margin-top: 4px; }
.badge-yes { color: var(--lime); font-weight: 700; }
.badge-no { color: #f87171; font-weight: 600; }
.badge-mid { color: #fbbf24; font-weight: 600; }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.mini-card {
  padding: 18px; border-radius: 16px; background: rgba(255,255,255,0.03); border: 1px solid var(--border);
  min-width: 0; max-width: 100%;
}
.mini-card h3 { margin-top: 0; font-size: 15px; }
.code-box {
  position: relative; background: #0d1017; border: 1px solid var(--border);
  border-radius: 14px; padding: 14px 76px 14px 16px; overflow-x: auto; max-width: 100%; margin: 10px 0 14px;
}
.code-box pre { margin: 0; font-size: 12.5px; color: #dbe7ff; line-height: 1.55; white-space: pre; }
.copy-btn {
  position: absolute; top: 10px; right: 10px; cursor: pointer;
  background: rgba(255,255,255,0.09); color: var(--text); border: 1px solid var(--border);
  border-radius: 999px; padding: 4px 11px; font-size: 11.5px; font-family: inherit;
}
.copy-btn:hover { background: var(--lime); color: var(--lime-ink); border-color: transparent; }
.step-num {
  display: inline-flex; width: 24px; height: 24px; border-radius: 999px; align-items: center; justify-content: center;
  background: var(--lime); color: var(--lime-ink); font-weight: 800; font-size: 12.5px; margin-right: 8px;
}
.faq-item { padding: 14px 0; border-top: 1px solid var(--border); }
.faq-item:first-of-type { border-top: none; padding-top: 4px; }
.faq-q { font-weight: 700; color: var(--text); font-size: 15px; margin-bottom: 6px; }
.faq-a { color: var(--sub); font-size: 14px; margin: 0; }
.related-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
.related-link {
  display: block; padding: 14px 16px; border-radius: 14px; text-decoration: none;
  background: rgba(255,255,255,0.03); border: 1px solid var(--border); transition: border-color 0.16s;
}
.related-link:hover { border-color: rgba(212, 240, 68, 0.45); }
.related-link strong { display: block; font-size: 14px; color: var(--text); margin-bottom: 4px; }
.related-link span { font-size: 12.5px; color: var(--sub); }
footer {
  max-width: 1020px; margin: 0 auto; padding: 24px 20px 44px;
  border-top: 1px solid var(--border); display: flex; justify-content: space-between;
  gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--dim);
}
.footer-links { display: flex; gap: 14px; flex-wrap: wrap; }
.footer-links a { color: var(--sub); text-decoration: none; }
.footer-links a:hover { color: var(--lime); }
.rec-banner {
  border-color: rgba(212, 240, 68, 0.38);
  background: linear-gradient(135deg, rgba(212, 240, 68, 0.085) 0%, var(--surface) 62%);
  display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap;
}
.rec-banner-copy { flex: 1 1 320px; min-width: 0; }
.rec-pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700; color: var(--lime); background: rgba(212, 240, 68, 0.14);
  border: 1px solid rgba(212, 240, 68, 0.34); margin-bottom: 8px;
}
.rec-banner h2 { margin: 0 0 6px; font-size: 19px; }
.rec-banner p { margin: 0; font-size: 13.5px; color: var(--sub); }
.rec-banner-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; }
tr.row-recommended td { background: rgba(212, 240, 68, 0.065); }
tr.row-recommended td:first-child { box-shadow: inset 3px 0 0 var(--lime); }
@media (max-width: 780px) {
  .grid-2, .grid-3, .related-grid { grid-template-columns: 1fr; }
  .hero, .card { padding: 20px 18px; }
  .nav-right { width: 100%; justify-content: space-between; }
  .lang-menu { right: 0; max-width: calc(100vw - 24px); }
  .rec-banner-actions { width: 100%; align-items: stretch; }
}
`;

function renderPage({ locale, slug, title, description, eyebrow, h1, lead, breadcrumbLabel, bodyHtml, faqs, howToSteps, today }) {
  const lm = LOCALE_META[locale];
  const nav = NAV_I18N[locale];
  const canonical = pageUrl(locale, slug);
  const homeHref = homePath(locale);

  const graph = [
    {
      '@type': 'WebPage',
      '@id': `${canonical}#webpage`,
      url: canonical,
      name: title,
      description,
      inLanguage: lm.htmlLang,
      isPartOf: { '@id': 'https://kurocat.org/#website' },
      about: { '@id': 'https://kurocat.org/#software' },
      dateModified: today,
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'KuroCat', item: `https://kurocat.org${homeHref}` },
        { '@type': 'ListItem', position: 2, name: breadcrumbLabel, item: canonical },
      ],
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://kurocat.org/#software',
      name: 'KuroCat',
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Windows 11, Windows 10, Windows 7, macOS 10.15+, Linux, Android',
      softwareVersion: RELEASE_VER_NUM,
      url: 'https://kurocat.org/',
      downloadUrl: pageUrl(locale, 'download'),
      codeRepository: 'https://github.com/qianyiai/KuroCat',
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      image: 'https://kurocat.org/assets/og-cover.png',
    },
  ];

  if (faqs && faqs.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }

  if (howToSteps && howToSteps.length) {
    graph.push({
      '@type': 'HowTo',
      '@id': `${canonical}#howto`,
      name: h1,
      description,
      step: howToSteps.map((s, idx) => ({
        '@type': 'HowToStep',
        position: idx + 1,
        name: s.name,
        text: s.text,
      })),
    });
  }

  const relatedMap = {
    download: {
      title: nav.download,
      desc: {
        zh: '全平台直链与 SHA-256 校验',
        en: 'Win/Mac/Linux/Android CDN + SHA-256',
        ja: '全 OS 直リンク＆SHA-256 検証',
        ko: '전 플랫폼 직링크 & SHA-256 검증',
        es: 'CDN Win/Mac/Linux/Android + SHA-256',
        pt: 'CDN Win/Mac/Linux/Android + SHA-256',
        ru: 'Прямые ссылки Win/Mac/Linux/Android + SHA-256',
        de: 'Win/Mac/Linux/Android CDN + SHA-256',
      }[locale],
    },
    'vs/bongo-cat': {
      title: nav.vs,
      desc: {
        zh: '与 Bongo Cat 功能、占用与开源对比',
        en: '3D, macOS, OBS & AI comparison',
        ja: 'Bongo Cat との機能・負荷比較',
        ko: 'Bongo Cat 기능·성능 비교',
        es: 'Comparativa 3D, macOS, OBS e IA',
        pt: 'Comparativo 3D, macOS, OBS e IA',
        ru: 'Сравнение 3D, macOS, OBS и ИИ',
        de: 'Vergleich zu 3D, macOS, OBS & KI',
      }[locale],
    },
    obs: {
      title: nav.obs,
      desc: {
        zh: '免绿幕原生 Alpha 透明直播源教程',
        en: 'Zero chroma-key Browser Source setup',
        ja: 'クロマキー不要の OBS 透過導入手順',
        ko: '크로마키 없는 OBS 투명 브라우저 소스',
        es: 'Fuente de navegador transparente sin croma',
        pt: 'Fonte de navegador transparente sem chroma key',
        ru: 'Прозрачный источник браузера без хромакея',
        de: 'Transparente Browser-Quelle ohne Greenscreen',
      }[locale],
    },
    mcp: {
      title: nav.mcp,
      desc: {
        zh: 'Claude / Cursor / 豆包联动与 22 项 AI 捏脸',
        en: 'Claude/Cursor hooks & 22 facial params',
        ja: 'AI 連携＆22 項目の顔カスタムガイド',
        ko: 'AI 코딩 연동 & 22종 얼굴 커스텀',
        es: 'Hooks para Claude/Cursor y 22 parámetros faciales',
        pt: 'Hooks Claude/Cursor e 22 parâmetros faciais',
        ru: 'Хуки Claude/Cursor и 22 параметра внешности',
        de: 'Claude/Cursor-Hooks & 22 Gesichtsparameter',
      }[locale],
    },
    security: {
      title: nav.security,
      desc: {
        zh: '唯一官网认证 & 假冒站 kurocat.net 木马取证警告',
        en: 'Official verification & fake kurocat.net malware advisory',
        ja: '公式サイト認証＆偽サイト kurocat.net マルウェア警告',
        ko: '공식 사이트 인증 & 사칭 kurocat.net 악성코드 경고',
        es: 'Verificación oficial y alerta de malware en kurocat.net',
        pt: 'Verificação oficial e alerta de malware no falso kurocat.net',
        ru: 'Официальная проверка и предупреждение о фейке kurocat.net',
        de: 'Offizielle Verifizierung & Malware-Warnung zu kurocat.net',
      }[locale],
    },
  };
  const relatedCards = SUBPAGE_SLUGS.filter((s) => s !== slug).slice(0, 3)
    .map(
      (s) =>
        `<a class="related-link" href="${pagePath(locale, s)}"><strong>${esc(relatedMap[s].title)} →</strong><span>${esc(relatedMap[s].desc)}</span></a>`,
    )
    .join('\n          ');

  const faqHtml = faqs && faqs.length
    ? `<section class="card">
        <h2>FAQ</h2>
        ${faqs.map((f) => `<div class="faq-item"><div class="faq-q">${esc(f.q)}</div><p class="faq-a">${esc(f.a)}</p></div>`).join('\n        ')}
      </section>`
    : '';

  const hreflangLinks = [
    `<link rel="alternate" hreflang="x-default" href="${pageUrl('zh', slug)}" />`,
    ...LOCALES.map((l) => `<link rel="alternate" hreflang="${LOCALE_META[l].htmlLang}" href="${pageUrl(l, slug)}" />`),
  ].join('\n  ');

  const ogLocaleAlternates = LOCALES.filter((l) => l !== locale)
    .map((l) => `<meta property="og:locale:alternate" content="${LOCALE_META[l].ogLocale}" />`)
    .join('\n  ');

  const langMenuItems = LOCALES.map(
    (l) =>
      `<a class="lang-btn${l === locale ? ' active' : ''}" href="${pagePath(l, slug)}" role="menuitem"><span class="lang-code">${l.toUpperCase()}</span><span>${esc(LOCALE_META[l].nativeName)}</span></a>`,
  ).join('\n            ');

  const closeNoticeLabel = {
    zh: '关闭公告',
    en: 'Dismiss notice',
    ja: 'お知らせを閉じる',
    ko: '공지 닫기',
    es: 'Cerrar aviso',
    pt: 'Fechar aviso',
    ru: 'Закрыть уведомление',
    de: 'Hinweis schließen',
  }[locale];

  const moreGuidesTitle = {
    zh: '更多 KuroCat 官方专题',
    en: 'More Official KuroCat Guides',
    ja: 'その他の公式ガイド',
    ko: '더 많은 KuroCat 공식 가이드',
    es: 'Más guías oficiales de KuroCat',
    pt: 'Mais guias oficiais do KuroCat',
    ru: 'Другие официальные руководства KuroCat',
    de: 'Weitere offizielle KuroCat-Guides',
  }[locale];

  return `<!DOCTYPE html>
<html lang="${lm.htmlLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <meta name="author" content="谦一 (Qianyi)" />
  <link rel="canonical" href="${canonical}" />
  ${hreflangLinks}
  <link rel="alternate" type="text/plain" title="LLMs.txt" href="https://kurocat.org/llms.txt" />
  <meta property="og:site_name" content="${esc(lm.siteName)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="https://kurocat.org/assets/og-cover.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:locale" content="${lm.ogLocale}" />
  ${ogLocaleAlternates}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="https://kurocat.org/assets/og-cover.png" />
  <meta name="theme-color" content="#07080c" />
  <link rel="icon" href="/assets/favicon.ico" sizes="any" />
  <link rel="icon" type="image/png" href="/assets/kurocat-icon.png" />
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
  <style>${SHARED_CSS}</style>
  <script>try{if(localStorage.getItem('kurocat_official_alert_dismissed_v1')==='1')document.documentElement.classList.add('official-alert-dismissed');}catch(e){}</script>
</head>
<body>
  <header class="global-nav">
    <div class="nav-inner">
      <a class="brand" href="${homeHref}">
        <img src="/assets/kurocat-icon.png" alt="KuroCat" width="22" height="22" />
        <span>KuroCat</span>
        <span class="ver-pill">${RELEASE_VERSION}</span>
      </a>
      <div class="nav-right">
        <nav class="nav-links" aria-label="Primary">
          <a href="${homeHref}">${esc(nav.home)}</a>
          <a href="${pagePath(locale, 'download')}"${slug === 'download' ? ' class="active"' : ''}>${esc(nav.download)}</a>
          <a href="${pagePath(locale, 'vs/bongo-cat')}"${slug === 'vs/bongo-cat' ? ' class="active"' : ''}>${esc(nav.vs)}</a>
          <a href="${pagePath(locale, 'obs')}"${slug === 'obs' ? ' class="active"' : ''}>${esc(nav.obs)}</a>
          <a href="${pagePath(locale, 'mcp')}"${slug === 'mcp' ? ' class="active"' : ''}>${esc(nav.mcp)}</a>
          <a href="${pagePath(locale, 'security')}"${slug === 'security' ? ' class="active"' : ''}>${esc(nav.security)}</a>
          <a href="https://github.com/qianyiai/KuroCat" target="_blank" rel="me noopener">${esc(nav.github)}</a>
        </nav>
        <div class="lang-dropdown" id="lang-dropdown">
          <button class="lang-trigger" id="lang-trigger" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Language">
            <svg class="lang-globe" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span>${esc(lm.shortLabel)}</span>
            <svg class="lang-caret" width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="lang-menu" role="menu" aria-label="Language">
            ${langMenuItems}
          </div>
        </div>
      </div>
    </div>
  </header>

  <main class="wrap">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="${homeHref}">KuroCat</a>
      <span>/</span>
      <span>${esc(breadcrumbLabel)}</span>
    </nav>

    <section class="hero">
      <div class="eyebrow">${esc(eyebrow)}</div>
      <h1>${esc(h1)}</h1>
      <p class="lead">${esc(lead)}</p>
      <div class="cta-row">
        <a class="btn btn-lime" href="${slug === 'download' ? '#files' : pagePath(locale, 'download')}">${esc(nav.ctaDl)}</a>
        <a class="btn" href="${homeHref}">${esc(nav.ctaPlay)}</a>
        <a class="btn" href="https://github.com/qianyiai/KuroCat" target="_blank" rel="me noopener">GitHub ★</a>
      </div>
      <div class="official-bar" id="official-bar"><span>${esc(nav.officialStrip)}</span><button class="official-bar-close" id="official-bar-close" type="button" aria-label="${esc(closeNoticeLabel)}" title="${esc(closeNoticeLabel)}"><svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3.5 3.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>
    </section>

    ${bodyHtml}
    ${faqHtml}

    <section class="card">
      <h2>${esc(moreGuidesTitle)}</h2>
      <div class="related-grid">
        ${relatedCards}
      </div>
    </section>
  </main>

  <footer>
    <div>KuroCat Official (<code>kurocat.org</code>) · ${esc(nav.footerAuthor)}</div>
    <div class="footer-links">
      <a href="${homeHref}">${esc(nav.home)}</a>
      <a href="${pagePath(locale, 'download')}">${esc(nav.download)}</a>
      <a href="${pagePath(locale, 'vs/bongo-cat')}">${esc(nav.vs)}</a>
      <a href="${pagePath(locale, 'obs')}">${esc(nav.obs)}</a>
      <a href="${pagePath(locale, 'mcp')}">${esc(nav.mcp)}</a>
      <a href="${pagePath(locale, 'security')}">${esc(nav.security)}</a>
      <a href="https://qianyi.one/" rel="me noopener">Qianyi</a>
      <a href="https://github.com/qianyiai/KuroCat" target="_blank" rel="me noopener">GitHub</a>
    </div>
  </footer>

  <script>
    document.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-copy') || '';
        if (!text || !navigator.clipboard) return;
        navigator.clipboard.writeText(text).then(function () {
          var orig = btn.textContent;
          btn.textContent = ${JSON.stringify(nav.copied)};
          setTimeout(function () { btn.textContent = orig; }, 1600);
        });
      });
    });
    (function () {
      var dd = document.getElementById('lang-dropdown');
      var trigger = document.getElementById('lang-trigger');
      if (!dd || !trigger) return;
      function setOpen(open) {
        dd.classList.toggle('open', open);
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        setOpen(!dd.classList.contains('open'));
      });
      document.addEventListener('click', function (e) {
        if (!dd.contains(e.target)) setOpen(false);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && dd.classList.contains('open')) {
          setOpen(false);
          trigger.focus();
        }
      });
    })();
    (function () {
      var bar = document.getElementById('official-bar');
      var btn = document.getElementById('official-bar-close');
      if (!bar || !btn) return;
      btn.addEventListener('click', function () {
        try { localStorage.setItem('kurocat_official_alert_dismissed_v1', '1'); } catch (e) {}
        document.documentElement.classList.add('official-alert-dismissed');
        bar.hidden = true;
      });
    })();
  </script>
</body>
</html>`;
}

function buildDownloadPage(locale, today) {
  const nav = NAV_I18N[locale];
  const copy = {
    zh: {
      title: `KuroCat 官方下载（${RELEASE_VERSION}）— Windows / macOS / Linux / Android 全平台高速直链与 SHA-256 校验`,
      description: `KuroCat 唯一官方下载中心（kurocat.org）：提供 ${RELEASE_VERSION} Windows 10/11、Windows 7 离线绿包、macOS Universal DMG / Homebrew、Linux (.deb/.AppImage) 与 Android APK 官方高速直链及完整 SHA-256 校验值。`,
      eyebrow: `Official Downloads · ${RELEASE_VERSION} · Verified SHA-256`,
      h1: `KuroCat 官方全平台下载（${RELEASE_VERSION}）`,
      lead: '所有安装包均由开源仓库 github.com/qianyiai/KuroCat 自动构建并公开 SHA-256 摘要，提供 kurocat.org 国内高速直链与 GitHub Releases 双源下载。',
      breadcrumb: '全平台下载',
      tblTitle: '全平台安装包与 SHA-256 校验表',
      colPlat: '平台与架构',
      colFile: '文件名与 SHA-256',
      colSize: '体积',
      colDl: '官方下载',
      brewTitle: 'macOS 一键安装（Homebrew 推荐 · 自动解除隔离）',
      brewDesc: '通过官方 Homebrew Tap 安装会自动清理 com.apple.quarantine 隔离属性，无需手动执行 xattr，后续也可一行命令升级：',
      tipsTitle: 'Windows SmartScreen 与 macOS 首次启动指南',
      winTipTitle: 'Windows Edge / Chrome 提示「通常不会下载」或 SmartScreen 蓝框',
      winTipBody: '由于 KuroCat 是免费开源软件、未购买商业 EV 签名证书，浏览器首次下载新版 .exe 可能弹窗提示：Edge 点击下载项右侧 ··· →「保留」→「显示更多 ▾」→「仍然保留」；双击安装若遇蓝框点「更多信息」→「仍要运行」。你也可以用 PowerShell 运行 <code>Get-FileHash 文件名 -Algorithm SHA256</code> 与上表逐位核对。',
      macTipTitle: 'macOS 手动安装 DMG 解除隔离与权限开启',
      macTipBody: '将 KuroCat 拖入「应用程序」后，如提示无法验证开发者，在终端执行下方命令一次即可。随后在「系统设置 → 隐私与安全性」中勾选「辅助功能」与「输入监控」里的 KuroCat 即可全局响应键鼠。',
      faqs: [
        { q: 'KuroCat 的唯一官方下载地址是什么？', a: '唯一官方网站为 https://kurocat.org/download/，官方 GitHub Releases 为 https://github.com/qianyiai/KuroCat/releases，macOS 官方源为 qianyiai/homebrew-tap。其他第三方同名域名（如 kurocat.net）均非官方维护。' },
        { q: '如何验证下载的安装包没有被第三方篡改？', a: '下载后计算文件 SHA-256（Windows 用 Get-FileHash，macOS/Linux 用 shasum -a 256），与本页及 GitHub Releases 公布的 64 位 SHA-256 摘要完全一致即可确认原版无篡改。' },
        { q: 'Windows 7 或银河麒麟 / 统信 Linux 能用吗？', a: '可以。Windows 7 SP1 64 位请下载内置 WebView2 109 的 win7-x64-portable.zip；Ubuntu 22.04+ / Debian 12+ / 银河麒麟 V11+（glibc >= 2.34）支持 x86_64 与 ARM64 的 .deb 及 .AppImage。' },
      ],
    },
    en: {
      title: `Download KuroCat (${RELEASE_VERSION}) — Official Windows, macOS, Linux & Android Builds + SHA-256`,
      description: `Official KuroCat download hub (kurocat.org): fast CDN mirrors and GitHub Releases for Windows 10/11, Windows 7 portable, macOS Apple Silicon/Intel DMG & Homebrew, Linux (.deb/.AppImage), and Android APK with verified SHA-256 checksums.`,
      eyebrow: `Official Downloads · ${RELEASE_VERSION} · Verified SHA-256`,
      h1: `Download KuroCat (${RELEASE_VERSION}) — All Platforms`,
      lead: 'Every installer is built transparently from github.com/qianyiai/KuroCat with verified SHA-256 checksums. Choose fast official kurocat.org CDN links or direct GitHub Releases.',
      breadcrumb: 'Download',
      tblTitle: 'Official Installers & SHA-256 Checksums',
      colPlat: 'Platform',
      colFile: 'Filename & SHA-256',
      colSize: 'Size',
      colDl: 'Download',
      brewTitle: 'macOS One-Line Install via Official Homebrew Tap',
      brewDesc: 'Recommended on macOS: automatically clears quarantine attributes (no manual xattr needed) and supports instant upgrades:',
      tipsTitle: 'First-Launch Tips (Windows SmartScreen & macOS Gatekeeper)',
      winTipTitle: 'Windows Edge / Chrome Warning or SmartScreen Prompt',
      winTipBody: 'KuroCat is free MIT open-source software without a commercial EV code-signing certificate. In Edge click ··· → Keep → Show more → Keep anyway; on the SmartScreen dialog click More info → Run anyway. Verify integrity anytime with <code>Get-FileHash &lt;file&gt; -Algorithm SHA256</code>.',
      macTipTitle: 'macOS Manual DMG Gatekeeper & Input Permissions',
      macTipBody: 'After dragging KuroCat.app into Applications, run the command below once if macOS warns about an unidentified developer, then enable KuroCat in System Settings → Privacy & Security → Accessibility and Input Monitoring.',
      faqs: [
        { q: 'Where is the only official place to download KuroCat?', a: 'Only https://kurocat.org/download/, https://github.com/qianyiai/KuroCat/releases, and Homebrew Tap qianyiai/homebrew-tap are official. Unaffiliated mirror sites like kurocat.net are not maintained by the author.' },
        { q: 'Does KuroCat support macOS Apple Silicon (M1–M4) and Linux?', a: 'Yes. The macOS Universal DMG natively supports M1/M2/M3/M4 and Intel Macs (macOS 10.15+). Linux supports x86_64 and ARM64 via .deb and portable .AppImage (glibc >= 2.34).' },
        { q: 'Why is the Windows installer only 2.40 MB?', a: 'KuroCat is built with Tauri v2 and Rust, reusing the OS native WebView2 instead of bundling a 150 MB Chromium binary like Electron apps.' },
      ],
    },
    ja: {
      title: `KuroCat 公式ダウンロード（${RELEASE_VERSION}）— Windows / macOS / Linux / Android 全 OS 対応＆SHA-256`,
      description: `KuroCat 唯一の公式ダウンロードページ（kurocat.org）。Windows 10/11、Windows 7 専用ポータブル、macOS (M1–M4 / Intel / Homebrew)、Linux (.deb/.AppImage)、Android APK を高速ミラーと SHA-256 ハッシュ付きで配布。`,
      eyebrow: `Official Downloads · ${RELEASE_VERSION} · Verified SHA-256`,
      h1: `KuroCat 公式ダウンロード（${RELEASE_VERSION}）`,
      lead: 'すべてのパッケージは github.com/qianyiai/KuroCat から公開ビルドされ、SHA-256 チェックサムで改ざん検証が可能です。',
      breadcrumb: 'ダウンロード',
      tblTitle: '全プラットフォーム公式ビルド＆SHA-256 一覧',
      colPlat: '対応 OS',
      colFile: 'ファイル名・SHA-256',
      colSize: '容量',
      colDl: 'ダウンロード',
      brewTitle: 'macOS Homebrew 1 行インストール（推奨・検疫自動解除）',
      brewDesc: '公式 Homebrew Tap を使えば初回検疫属性（quarantine）も自動解除され、アップデートも 1 行で完了します：',
      tipsTitle: '初回起動ガイド（Windows SmartScreen / macOS 権限）',
      winTipTitle: 'Windows でダウンロード警告や SmartScreen が出た場合',
      winTipBody: '無料オープンソースで商用 EV 署名がないため警告が出る場合があります。Edge は「…」→「保存」→「詳細表示」→「保持する」、SmartScreen は「詳細情報」→「実行」で起動できます。',
      macTipTitle: 'macOS 手動 DMG 導入時の検疫解除と権限設定',
      macTipBody: '「アプリケーション」にコピー後、開発元未確認と出た場合はターミナルで下のコマンドを一度実行し、「システム設定 → プライバシーとセキュリティ」でアクセシビリティと入力監視を許可してください。',
      faqs: [
        { q: 'KuroCat の正規ダウンロード元はどこですか？', a: '公式サイト https://kurocat.org/ja/download/、GitHub Releases (github.com/qianyiai/KuroCat)、および Homebrew Tap (qianyiai/homebrew-tap) のみが公式です。kurocat.net などの第三者ドメインは非公式です。' },
        { q: 'Mac (Apple Silicon M1〜M4) や Linux でも使えますか？', a: 'はい。macOS は M1〜M4 / Intel 両対応 Universal DMG と Homebrew、Linux は x86_64 / ARM64 の .deb と .AppImage を提供しています。' },
      ],
    },
    ko: {
      title: `KuroCat 공식 다운로드 (${RELEASE_VERSION}) — Windows / macOS / Linux / Android 전 플랫폼 + SHA-256`,
      description: `KuroCat 유일한 공식 다운로드 센터(kurocat.org): Windows 10/11, Windows 7 포터블, macOS 유니버설 DMG & Homebrew, Linux (.deb/.AppImage), Android APK 고속 직링크 및 SHA-256 무결성 검증 제공.`,
      eyebrow: `Official Downloads · ${RELEASE_VERSION} · Verified SHA-256`,
      h1: `KuroCat 공식 전 플랫폼 다운로드 (${RELEASE_VERSION})`,
      lead: '모든 설치 파일은 github.com/qianyiai/KuroCat 오픈소스 저장소에서 투명하게 빌드되며 SHA-256 체크섬으로 무결성을 검증할 수 있습니다.',
      breadcrumb: '다운로드',
      tblTitle: '플랫폼별 공식 설치 파일 및 SHA-256 검증',
      colPlat: '플랫폼',
      colFile: '파일명 & SHA-256',
      colSize: '용량',
      colDl: '다운로드',
      brewTitle: 'macOS Homebrew 한 줄 설치 (권장 · 격리 자동 해제)',
      brewDesc: '공식 Homebrew Tap을 사용하면 수동 xattr 없이 바로 설치되고 업데이트도 한 줄로 끝납니다:',
      tipsTitle: '첫 실행 안내 (Windows SmartScreen / macOS Gatekeeper)',
      winTipTitle: 'Windows 브라우저 경고 또는 SmartScreen 파란 창 안내',
      winTipBody: '무료 MIT 오픈소스 소프트웨어로 상용 EV 인증서가 없어 경고가 뜰 수 있습니다. Edge에서 ··· → 유지 → 더 보기 → 그래도 유지, SmartScreen에서 추가 정보 → 실행을 클릭하세요.',
      macTipTitle: 'macOS DMG 수동 설치 시 격리 해제 및 권한 허용',
      macTipBody: '응용 프로그램으로 복사한 뒤 개발자 확인 불가 알림이 뜨면 아래 명령어를 터미널에서 한 번 실행하고, 시스템 설정 → 개인정보 보호 및 보안에서 손쉬운 사용과 입력 모니터링을 허용하세요.',
      faqs: [
        { q: 'KuroCat의 공식 다운로드 경로는 어디인가요?', a: 'https://kurocat.org/ko/download/, https://github.com/qianyiai/KuroCat/releases, 그리고 Homebrew Tap(qianyiai/homebrew-tap)만 공식입니다. kurocat.net 등 제3자 사이트는 비공식입니다.' },
        { q: '설치 파일 용량이 왜 이렇게 가볍나요?', a: 'Electron 대신 Tauri v2 + Rust로 제작해 시스템 내장 WebView를 활용하므로 Windows 설치 파일이 2.40 MB에 불과합니다.' },
      ],
    },
    es: {
      title: `Descargar KuroCat (${RELEASE_VERSION}) — Instaladores oficiales para Windows, macOS, Linux y Android + SHA-256`,
      description: `Centro oficial de descargas de KuroCat (kurocat.org): enlaces rápidos de CDN y GitHub Releases para Windows 10/11, Windows 7 portátil, macOS Apple Silicon/Intel DMG y Homebrew, Linux (.deb/.AppImage) y APK de Android con sumas SHA-256 verificadas.`,
      eyebrow: `Descargas oficiales · ${RELEASE_VERSION} · SHA-256 verificado`,
      h1: `Descargar KuroCat (${RELEASE_VERSION}) — Todas las plataformas`,
      lead: 'Todos los instaladores se compilan de forma transparente desde github.com/qianyiai/KuroCat con sumas SHA-256 verificadas. Elige entre nuestro CDN oficial rápido en kurocat.org o enlaces directos de GitHub Releases.',
      breadcrumb: 'Descargas',
      tblTitle: 'Instaladores oficiales y sumas de verificación SHA-256',
      colPlat: 'Plataforma',
      colFile: 'Archivo y SHA-256',
      colSize: 'Tamaño',
      colDl: 'Descargar',
      brewTitle: 'Instalación en un comando en macOS con Homebrew oficial',
      brewDesc: 'Recomendado en macOS: elimina automáticamente los atributos de cuarentena (sin xattr manual) y permite actualizar al instante:',
      tipsTitle: 'Guía del primer inicio (Windows SmartScreen y macOS Gatekeeper)',
      winTipTitle: 'Aviso de descarga en Edge / Chrome o pantalla de SmartScreen en Windows',
      winTipBody: 'KuroCat es software gratuito de código abierto bajo licencia MIT sin certificado comercial EV. En Edge haz clic en ··· → Conservar → Mostrar más → Conservar de todos modos; en SmartScreen haz clic en Más información → Ejecutar de todas formas. Puedes comprobar la integridad en cualquier momento con <code>Get-FileHash &lt;archivo&gt; -Algorithm SHA256</code>.',
      macTipTitle: 'Desbloqueo de Gatekeeper y permisos de entrada al instalar el DMG en macOS',
      macTipBody: 'Tras arrastrar KuroCat.app a Aplicaciones, ejecuta el comando de abajo una sola vez si macOS avisa de desarrollador no identificado y luego activa KuroCat en Ajustes del Sistema → Privacidad y seguridad → Accesibilidad y Supervisión de entrada.',
      faqs: [
        { q: '¿Cuál es el único sitio oficial para descargar KuroCat?', a: 'Solo https://kurocat.org/es/download/, https://github.com/qianyiai/KuroCat/releases y el Homebrew Tap qianyiai/homebrew-tap son oficiales. Sitios de terceros como kurocat.net no están afiliados al autor.' },
        { q: '¿KuroCat es compatible con macOS Apple Silicon (M1–M4) y Linux?', a: 'Sí. El DMG universal de macOS funciona de forma nativa en Macs M1/M2/M3/M4 e Intel (macOS 10.15+). En Linux ofrecemos paquetes .deb y .AppImage portátiles para x86_64 y ARM64 (glibc >= 2.34).' },
        { q: '¿Por qué el instalador de Windows pesa solo 2.40 MB?', a: 'KuroCat está desarrollado con Tauri v2 y Rust, reutilizando el WebView2 nativo del sistema en lugar de empaquetar un binario Chromium de 150 MB como las apps en Electron.' },
      ],
    },
    pt: {
      title: `Baixar KuroCat (${RELEASE_VERSION}) — Versões oficiais Windows, macOS, Linux e Android + SHA-256`,
      description: `Central oficial de downloads do KuroCat (kurocat.org): CDN rápido e GitHub Releases para Windows 10/11, Windows 7 portátil, macOS Apple Silicon/Intel DMG e Homebrew, Linux (.deb/.AppImage) e APK Android com hashes SHA-256 verificados.`,
      eyebrow: `Downloads oficiais · ${RELEASE_VERSION} · SHA-256 verificado`,
      h1: `Baixar KuroCat (${RELEASE_VERSION}) — Todas as plataformas`,
      lead: 'Todos os instaladores são compilados de forma transparente a partir de github.com/qianyiai/KuroCat com hashes SHA-256 verificados. Escolha o CDN oficial rápido em kurocat.org ou links diretos do GitHub Releases.',
      breadcrumb: 'Downloads',
      tblTitle: 'Instaladores oficiais e checksums SHA-256',
      colPlat: 'Plataforma',
      colFile: 'Arquivo e SHA-256',
      colSize: 'Tamanho',
      colDl: 'Baixar',
      brewTitle: 'Instalação em uma linha no macOS via Homebrew oficial',
      brewDesc: 'Recomendado no macOS: remove automaticamente o atributo de quarentena (sem precisar rodar xattr manualmente) e permite atualizar com um comando:',
      tipsTitle: 'Dicas para a primeira execução (Windows SmartScreen e macOS Gatekeeper)',
      winTipTitle: 'Aviso no Edge / Chrome ou tela azul do SmartScreen no Windows',
      winTipBody: 'O KuroCat é software gratuito de código aberto (MIT) sem certificado comercial EV. No Edge clique em ··· → Manter → Mostrar mais → Manter assim mesmo; no SmartScreen clique em Mais informações → Executar assim mesmo. Verifique a integridade quando quiser com <code>Get-FileHash &lt;arquivo&gt; -Algorithm SHA256</code>.',
      macTipTitle: 'Gatekeeper e permissões de entrada no DMG manual do macOS',
      macTipBody: 'Após arrastar KuroCat.app para Aplicativos, rode o comando abaixo uma vez se o macOS alertar sobre desenvolvedor não identificado e depois habilite o KuroCat em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade e Monitoramento de Entrada.',
      faqs: [
        { q: 'Onde fica o único lugar oficial para baixar o KuroCat?', a: 'Apenas https://kurocat.org/pt/download/, https://github.com/qianyiai/KuroCat/releases e o Homebrew Tap qianyiai/homebrew-tap são oficiais. Domínios de terceiros como kurocat.net não têm vínculo com o autor.' },
        { q: 'O KuroCat funciona em macOS Apple Silicon (M1–M4) e Linux?', a: 'Sim. O DMG universal de macOS roda nativamente em Macs M1/M2/M3/M4 e Intel (macOS 10.15+). No Linux há pacotes .deb e .AppImage portáteis para x86_64 e ARM64 (glibc >= 2.34).' },
        { q: 'Por que o instalador de Windows tem apenas 2,40 MB?', a: 'O KuroCat é construído com Tauri v2 e Rust, reaproveitando o WebView2 nativo do sistema operacional em vez de empacotar um Chromium de 150 MB como apps Electron.' },
      ],
    },
    ru: {
      title: `Скачать KuroCat (${RELEASE_VERSION}) — Официальные сборки для Windows, macOS, Linux и Android + SHA-256`,
      description: `Официальный центр загрузок KuroCat (kurocat.org): быстрый CDN и GitHub Releases для Windows 10/11, Windows 7 Portable, macOS Apple Silicon/Intel DMG и Homebrew, Linux (.deb/.AppImage) и Android APK с проверенными контрольными суммами SHA-256.`,
      eyebrow: `Официальные загрузки · ${RELEASE_VERSION} · Проверенный SHA-256`,
      h1: `Скачать KuroCat (${RELEASE_VERSION}) — Все платформы`,
      lead: 'Все установщики прозрачно собираются из открытого репозитория github.com/qianyiai/KuroCat с публикацией SHA-256. Выбирайте быстрое зеркало CDN на kurocat.org или прямые ссылки GitHub Releases.',
      breadcrumb: 'Скачать',
      tblTitle: 'Официальные установщики и хеши SHA-256',
      colPlat: 'Платформа',
      colFile: 'Имя файла и SHA-256',
      colSize: 'Размер',
      colDl: 'Скачать',
      brewTitle: 'Установка в одну команду на macOS через официальный Homebrew Tap',
      brewDesc: 'Рекомендуемый способ для macOS: автоматически снимает карантин (без ручного xattr) и позволяет обновляться одной командой:',
      tipsTitle: 'Первый запуск (Windows SmartScreen и macOS Gatekeeper)',
      winTipTitle: 'Предупреждение Edge / Chrome или окно SmartScreen в Windows',
      winTipBody: 'KuroCat — бесплатная программа с открытым кодом MIT без платного коммерческого EV-сертификата. В Edge нажмите ··· → Сохранить → Показать больше → Всё равно сохранить; в SmartScreen нажмите Подробнее → Выполнить в любом случае. Проверить целостность файла можно командой <code>Get-FileHash &lt;файл&gt; -Algorithm SHA256</code>.',
      macTipTitle: 'Снятие карантина Gatekeeper и права ввода при ручной установке DMG на macOS',
      macTipBody: 'После переноса KuroCat.app в «Программы» выполните один раз команду ниже, если macOS предупредит о неизвестном разработчике, а затем включите KuroCat в «Системные настройки → Конфиденциальность и безопасность → Универсальный доступ и Мониторинг ввода».',
      faqs: [
        { q: 'Где находится единственный официальный источник загрузки KuroCat?', a: 'Официальными являются только https://kurocat.org/ru/download/, https://github.com/qianyiai/KuroCat/releases и Homebrew Tap qianyiai/homebrew-tap. Сторонние домены вроде kurocat.net не имеют отношения к автору.' },
        { q: 'Поддерживает ли KuroCat macOS Apple Silicon (M1–M4) и Linux?', a: 'Да. Универсальный DMG для macOS нативно работает на Mac с чипами M1/M2/M3/M4 и Intel (macOS 10.15+). Для Linux доступны пакеты .deb и портативный .AppImage под x86_64 и ARM64 (glibc >= 2.34).' },
        { q: 'Почему установщик для Windows весит всего 2,40 МБ?', a: 'KuroCat написан на Tauri v2 и Rust и использует системный WebView2, не встраивая 150-мегабайтный движок Chromium, как приложения на Electron.' },
      ],
    },
    de: {
      title: `KuroCat herunterladen (${RELEASE_VERSION}) — Offizielle Builds für Windows, macOS, Linux & Android + SHA-256`,
      description: `Offizielles KuroCat-Download-Center (kurocat.org): schnelles CDN und GitHub Releases für Windows 10/11, Windows 7 Portabel, macOS Apple Silicon/Intel DMG & Homebrew, Linux (.deb/.AppImage) und Android APK mit verifizierten SHA-256-Prüfsummen.`,
      eyebrow: `Offizielle Downloads · ${RELEASE_VERSION} · SHA-256 verifiziert`,
      h1: `KuroCat herunterladen (${RELEASE_VERSION}) — Alle Plattformen`,
      lead: 'Jedes Installationspaket wird transparent aus github.com/qianyiai/KuroCat gebaut und mit SHA-256-Prüfsummen veröffentlicht. Nutze wahlweise unser schnelles offizielles CDN auf kurocat.org oder direkte GitHub Releases.',
      breadcrumb: 'Downloads',
      tblTitle: 'Offizielle Installationspakete & SHA-256-Prüfsummen',
      colPlat: 'Plattform',
      colFile: 'Dateiname & SHA-256',
      colSize: 'Größe',
      colDl: 'Download',
      brewTitle: 'macOS-Einzeiler über den offiziellen Homebrew Tap',
      brewDesc: 'Empfohlen unter macOS: entfernt automatisch das Quarantäne-Attribut (kein manuelles xattr nötig) und unterstützt sofortige Updates:',
      tipsTitle: 'Hinweise zum ersten Start (Windows SmartScreen & macOS Gatekeeper)',
      winTipTitle: 'Edge-/Chrome-Warnung oder Windows SmartScreen-Dialog',
      winTipBody: 'KuroCat ist kostenlose MIT-Open-Source-Software ohne kommerzielles EV-Signaturzertifikat. Klicke in Edge auf ··· → Behalten → Mehr anzeigen → Trotzdem behalten; bei SmartScreen auf Weitere Informationen → Trotzdem ausführen. Die Integrität prüfst du jederzeit mit <code>Get-FileHash &lt;Datei&gt; -Algorithm SHA256</code>.',
      macTipTitle: 'Gatekeeper-Freigabe & Eingaberechte bei manueller DMG-Installation unter macOS',
      macTipBody: 'Nachdem du KuroCat.app in den Programme-Ordner gezogen hast, führe den folgenden Befehl einmalig aus, falls macOS einen nicht verifizierten Entwickler meldet, und aktiviere KuroCat unter Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen und Eingabeüberwachung.',
      faqs: [
        { q: 'Was ist die einzige offizielle Quelle für KuroCat-Downloads?', a: 'Nur https://kurocat.org/de/download/, https://github.com/qianyiai/KuroCat/releases und der Homebrew Tap qianyiai/homebrew-tap sind offiziell. Fremde Domains wie kurocat.net stehen in keiner Verbindung zum Autor.' },
        { q: 'Unterstützt KuroCat macOS Apple Silicon (M1–M4) und Linux?', a: 'Ja. Das universelle macOS-DMG läuft nativ auf M1/M2/M3/M4- und Intel-Macs (macOS 10.15+). Unter Linux werden x86_64 und ARM64 per .deb und portablem .AppImage unterstützt (glibc >= 2.34).' },
        { q: 'Warum ist der Windows-Installer nur 2,40 MB groß?', a: 'KuroCat basiert auf Tauri v2 und Rust und nutzt die systemeigene WebView2-Laufzeitumgebung, statt wie Electron-Apps ein 150 MB großes Chromium-Paket mitzuliefern.' },
      ],
    },
  }[locale];

  const recI18n = {
    zh: { badge: '已自动识别你的设备', iosTitle: '已检测到 iOS / iPadOS 设备', iosDesc: '当前提供 Windows / macOS / Linux / Android 安装包，请在电脑或安卓手机下载。', dlBtn: '立即高速下载', ghBtn: 'GitHub 官方源 ›' },
    en: { badge: 'Recommended for Your Device', iosTitle: 'iOS / iPadOS Detected', iosDesc: 'KuroCat currently ships for Windows, macOS, Linux & Android — pick your device build below.', dlBtn: 'Fast CDN Download', ghBtn: 'GitHub Mirror ›' },
    ja: { badge: 'お使いの端末におすすめ', iosTitle: 'iOS / iPadOS を検出しました', iosDesc: '現在 Windows / macOS / Linux / Android 版を提供しています。PC または Android 端末からダウンロードしてください。', dlBtn: '高速ダウンロード', ghBtn: 'GitHub 公式 ›' },
    ko: { badge: '내 기기 자동 추천', iosTitle: 'iOS / iPadOS 기기 감지됨', iosDesc: '현재 Windows / macOS / Linux / Android 버전을 제공합니다. PC 또는 안드로이드 기기에서 다운로드해 주세요.', dlBtn: '고속 직링크 다운로드', ghBtn: 'GitHub 공식 ›' },
    es: { badge: 'Recomendado para tu dispositivo', iosTitle: 'iOS / iPadOS detectado', iosDesc: 'KuroCat está disponible actualmente para Windows, macOS, Linux y Android en la tabla inferior.', dlBtn: 'Descarga rápida CDN', ghBtn: 'GitHub oficial ›' },
    pt: { badge: 'Recomendado para seu dispositivo', iosTitle: 'iOS / iPadOS detectado', iosDesc: 'O KuroCat está disponível para Windows, macOS, Linux e Android na lista abaixo.', dlBtn: 'Download rápido CDN', ghBtn: 'GitHub oficial ›' },
    ru: { badge: 'Подобрано для вашего устройства', iosTitle: 'Обнаружено устройство iOS / iPadOS', iosDesc: 'Сейчас доступны сборки для Windows, macOS, Linux и Android — выберите нужную ниже.', dlBtn: 'Быстрая загрузка CDN', ghBtn: 'GitHub Releases ›' },
    de: { badge: 'Für dein Gerät empfohlen', iosTitle: 'iOS / iPadOS erkannt', iosDesc: 'KuroCat ist derzeit für Windows, macOS, Linux und Android in der Liste unten verfügbar.', dlBtn: 'Schneller CDN-Download', ghBtn: 'GitHub Releases ›' },
  }[locale];

  const rows = VERIFIED_ASSETS.map((a) => {
    const cdnUrl = `/releases/${RELEASE_VERSION}/${a.file}`;
    const ghUrl = `https://github.com/qianyiai/KuroCat/releases/download/${RELEASE_VERSION}/${a.file}`;
    return `<tr data-asset-key="${esc(a.key)}">
            <td><strong>${esc(a.platform[locale])}</strong><br /><span style="font-size:12px;color:var(--dim)">${esc(a.desc[locale])}</span></td>
            <td><code>${esc(a.file)}</code><span class="sha">${esc(a.sha256)}</span></td>
            <td style="white-space:nowrap">${esc(a.size)}</td>
            <td style="white-space:nowrap">
              <div style="display:flex;flex-direction:column;gap:6px">
                <a class="btn btn-lime btn-sm" href="${cdnUrl}" download>${esc(nav.cdnBtn)}</a>
                <a class="btn btn-sm" href="${ghUrl}" target="_blank" rel="noopener">${esc(nav.ghBtn)}</a>
              </div>
            </td>
          </tr>`;
  }).join('\n          ');

  const recAssetMap = Object.fromEntries(
    VERIFIED_ASSETS.map((a) => [
      a.key,
      {
        platform: a.platform[locale],
        desc: a.desc[locale],
        file: a.file,
        size: a.size,
        cdnUrl: `/releases/${RELEASE_VERSION}/${a.file}`,
        ghUrl: `https://github.com/qianyiai/KuroCat/releases/download/${RELEASE_VERSION}/${a.file}`,
      },
    ]),
  );

  const brewCmd = 'brew install --cask qianyiai/tap/kurocat';
  const xattrCmd = 'xattr -cr /Applications/KuroCat.app && open /Applications/KuroCat.app';

  const bodyHtml = `
    <section class="card rec-banner" id="dl-auto-recommend">
      <div class="rec-banner-copy">
        <span class="rec-pill" id="rec-os-badge">✨ ${esc(recI18n.badge)}</span>
        <h2 id="rec-os-title">${esc(VERIFIED_ASSETS[0].platform[locale])}</h2>
        <p id="rec-os-desc">${esc(VERIFIED_ASSETS[0].desc[locale])} · <code>${esc(VERIFIED_ASSETS[0].file)}</code> (${esc(VERIFIED_ASSETS[0].size)})</p>
      </div>
      <div class="rec-banner-actions" id="rec-os-actions">
        <a class="btn btn-lime" id="rec-os-cdn" href="/releases/${RELEASE_VERSION}/${VERIFIED_ASSETS[0].file}" download>${esc(recI18n.dlBtn)} (${esc(VERIFIED_ASSETS[0].size)})</a>
        <a class="btn btn-sm" id="rec-os-gh" href="https://github.com/qianyiai/KuroCat/releases/download/${RELEASE_VERSION}/${VERIFIED_ASSETS[0].file}" target="_blank" rel="noopener">${esc(recI18n.ghBtn)}</a>
      </div>
    </section>

    <section class="card" id="files">
      <h2>${esc(copy.tblTitle)}</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>${esc(copy.colPlat)}</th><th>${esc(copy.colFile)}</th><th>${esc(copy.colSize)}</th><th>${esc(copy.colDl)}</th></tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>

    <script>
      (function () {
        var ASSETS = ${JSON.stringify(recAssetMap)};
        var I18N = ${JSON.stringify(recI18n)};
        function detectKey() {
          try {
            var p = (new URLSearchParams(location.search).get('os') || '').trim().toLowerCase();
            if (p === 'android') return 'android';
            if (p === 'ios' || p === 'iphone' || p === 'ipad') return 'ios';
            if (p === 'mac' || p === 'macos') return 'macos';
            if (p === 'win7') return 'win7';
            if (p === 'win' || p === 'windows') return 'win64';
            if (p === 'linux-arm64' || p === 'arm64') return 'linux-arm64-deb';
            if (p === 'linux' || p === 'linux-x64') return 'linux-x64-deb';
          } catch (e) {}
          var ua = navigator.userAgent || '';
          var plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
          var all = ua + ' ' + plat;
          if (/Android/i.test(all)) return 'android';
          if (/iPhone|iPad|iPod/i.test(all) || (/MacIntel/i.test(navigator.platform || '') && navigator.maxTouchPoints > 1)) return 'ios';
          if (/Windows NT 6\\.[123]/i.test(ua)) return 'win7';
          if (/Win/i.test(plat) || /Windows/i.test(ua)) return 'win64';
          if (/Mac|Macintosh/i.test(all)) return 'macos';
          if (/Linux|X11/i.test(all)) return /aarch64|arm64|armv8/i.test(all) ? 'linux-arm64-deb' : 'linux-x64-deb';
          return 'win64';
        }
        var key = detectKey();
        var titleEl = document.getElementById('rec-os-title');
        var descEl = document.getElementById('rec-os-desc');
        var cdnEl = document.getElementById('rec-os-cdn');
        var ghEl = document.getElementById('rec-os-gh');
        var actionsEl = document.getElementById('rec-os-actions');
        var heroCta = document.querySelector('.hero .cta-row .btn-lime');
        if (key === 'ios') {
          if (titleEl) titleEl.textContent = I18N.iosTitle;
          if (descEl) descEl.textContent = I18N.iosDesc;
          if (actionsEl) actionsEl.style.display = 'none';
          return;
        }
        var item = ASSETS[key] || ASSETS.win64;
        if (titleEl) titleEl.textContent = item.platform;
        if (descEl) descEl.innerHTML = item.desc + ' · <code>' + item.file + '</code> (' + item.size + ')';
        if (cdnEl) { cdnEl.href = item.cdnUrl; cdnEl.textContent = I18N.dlBtn + ' (' + item.size + ')'; }
        if (ghEl) { ghEl.href = item.ghUrl; }
        if (heroCta) { heroCta.href = item.cdnUrl; heroCta.setAttribute('download', ''); heroCta.textContent = item.platform + ' · ' + item.size; }
        var tr = document.querySelector('tr[data-asset-key="' + key + '"]');
        if (tr) tr.classList.add('row-recommended');
      })();
    </script>

    <section class="card">
      <h2>${esc(copy.brewTitle)}</h2>
      <p>${esc(copy.brewDesc)}</p>
      <div class="code-box">
        <button class="copy-btn" type="button" data-copy="${esc(brewCmd)}">${esc(nav.copy)}</button>
        <pre>${esc(brewCmd)}</pre>
      </div>
    </section>

    <section class="card">
      <h2>${esc(copy.tipsTitle)}</h2>
      <div class="grid-2">
        <div class="mini-card">
          <h3>${esc(copy.winTipTitle)}</h3>
          <p>${copy.winTipBody}</p>
        </div>
        <div class="mini-card">
          <h3>${esc(copy.macTipTitle)}</h3>
          <p>${esc(copy.macTipBody)}</p>
          <div class="code-box">
            <button class="copy-btn" type="button" data-copy="${esc(xattrCmd)}">${esc(nav.copy)}</button>
            <pre>${esc(xattrCmd)}</pre>
          </div>
        </div>
      </div>
    </section>
  `;

  return renderPage({
    locale,
    slug: 'download',
    title: copy.title,
    description: copy.description,
    eyebrow: copy.eyebrow,
    h1: copy.h1,
    lead: copy.lead,
    breadcrumbLabel: copy.breadcrumb,
    bodyHtml,
    faqs: copy.faqs,
    today,
  });
}

function buildVsBongoCatPage(locale, today) {
  const copy = {
    zh: {
      title: 'KuroCat vs Bongo Cat — 为什么 KuroCat 是 2026 最好的免费开源 3D Bongo Cat 替代品',
      description: '全面对比 KuroCat 与传统 Bongo Cat / Steam Bongo Cat：MIT 开源免费、3D 手办与 2D 经典双引擎、2.4 MB Rust 轻量体积、原生 macOS/Linux/Win7、输密码自动闭眼防偷窥、OBS 免绿幕透明源与 AI MCP 捏脸。',
      eyebrow: 'Comparison · Open-Source Bongo Cat Alternative',
      h1: 'KuroCat vs Bongo Cat：全维度对比',
      lead: '如果你在找一款支持 3D 立体手办、原生支持 macOS / Linux / Win7、打密码自动闭眼、直播免绿幕抠像，而且完全免费开源的 Bongo Cat 替代品，下表一目了然。',
      breadcrumb: 'vs Bongo Cat',
      tblTitle: '核心能力逐项对比',
      colFeat: '对比项',
      colKuro: 'KuroCat（官方开源）',
      colBongo: '传统 / Steam Bongo Cat',
      rows: [
        ['开源协议与价格', '<span class="badge-yes">100% 免费 · MIT 开源（零内购/零广告）</span>', '<span class="badge-mid">闭源或社区旧改版（部分含内购/抽箱）</span>'],
        ['3D 立体 / 2D 双引擎', '<span class="badge-yes">一键切换 3D 立体手办 + 2D 经典（支持 360° 旋转）</span>', '<span class="badge-no">仅 2D 平面贴图</span>'],
        ['安装包与性能占用', '<span class="badge-yes">Tauri v2 + Rust 仅 2.40 MB · 游戏自动 30 FPS 省电</span>', '<span class="badge-mid">通常 60–180 MB，部分版本空闲仍占 GPU</span>'],
        ['跨平台支持', '<span class="badge-yes">Win11/10/7 + macOS (M1–M4/Intel/Homebrew) + Linux + Android</span>', '<span class="badge-no">大多仅限 Windows（Mac/Linux 兼容差）</span>'],
        ['键盘与鼠标精度', '<span class="badge-yes">65% / 108 键全尺寸 + 双视角 + 左右中键独立分色 + 尾巴拍键</span>', '<span class="badge-mid">固定单键位或简单左右拍动</span>'],
        ['输密码防偷窥', '<span class="badge-yes">系统级自动识别密码框：自动闭眼/捂眼并遮蔽键帽</span>', '<span class="badge-no">不支持（直播输密码易泄露节奏/键位）</span>'],
        ['OBS 直播透明源', '<span class="badge-yes">内置本机 Alpha 透明浏览器源（免绿幕抠像 + 仅 OBS 模式）</span>', '<span class="badge-mid">需绿幕色度抠像或窗口捕获，边缘易有绿边</span>'],
        ['AI 伴侣 & MCP 捏脸', '<span class="badge-yes">内置 MCP（22 项五官捏脸/异瞳/折耳）+ Claude/Codex/豆包联动</span>', '<span class="badge-no">不支持</span>'],
      ],
      whyTitle: '三大杀手级体验差异',
      cards: [
        ['🙈 直播和办公不再怕社死', 'KuroCat 在 Windows 与 macOS 底层自动检测密码输入框，聚焦密码栏瞬间猫咪乖巧闭眼、停止外传按键气泡，OBS 直播源同步隐藏。'],
        ['⚡ 2.4 MB Rust 内核，不卡 3A 与竞技网游', '3D 键帽图集合批渲染，检测到全屏游戏自动切换 30 FPS 省电模式，并支持托盘一键「反作弊护航暂停钩子」。'],
        ['🎨 发照片让 AI 0.4 秒捏出你家毛孩子', '内置免依赖 MCP 服务，直接支持 5 种脸型、7 种耳型（含折耳/垂耳）、5 种瞳孔、异瞳、吐舌与自定义斑点。'],
      ],
      faqs: [
        { q: 'KuroCat 和 Bongo Cat 相比有哪些核心优势？', a: 'KuroCat 是 MIT 完全免费开源的现代化替代方案，支持 3D/2D 双引擎切换、Win/Mac/Linux/Android 全平台、密码防偷窥、免绿幕 OBS 透明源以及内置 AI MCP 捏脸，安装包仅 2.40 MB。' },
        { q: 'Mac (M1/M2/M3/M4) 上有能用的 Bongo Cat 吗？', a: '有，KuroCat 原生提供 Apple Silicon + Intel 通用版，支持一行命令 brew install --cask qianyiai/tap/kurocat 安装，并完整兼容 macOS 休眠唤醒与 Karabiner-Elements。' },
        { q: '打瓦/三角洲等强反作弊游戏安全吗？', a: 'KuroCat 仅在本地监听键鼠动作（零网络上传按键内容），且托盘提供一键「暂停监听并隐藏（游戏反作弊护航）」，玩强内核反作弊网游前点一下即可彻底卸载钩子。' },
      ],
    },
    en: {
      title: 'KuroCat vs Bongo Cat — Best Free Open-Source 3D Bongo Cat Alternative (Win/Mac/Linux)',
      description: 'Compare KuroCat with classic Bongo Cat and Steam Bongo Cat: MIT open-source, 3D figurine + 2D dual engine, 2.40 MB Rust/Tauri build, native macOS (Homebrew) & Linux, OS password privacy guard, zero chroma-key OBS overlay, and MCP AI pet studio.',
      eyebrow: 'Comparison · Free Open-Source Bongo Cat Alternative',
      h1: 'KuroCat vs Bongo Cat: Full Feature Comparison',
      lead: 'Looking for a modern, lightweight, open-source Bongo Cat alternative that works natively on Windows, macOS (M1–M4), and Linux — with 3D rendering, password privacy, and OBS alpha transparency?',
      breadcrumb: 'vs Bongo Cat',
      tblTitle: 'Feature-by-Feature Comparison',
      colFeat: 'Feature',
      colKuro: 'KuroCat (Official Open Source)',
      colBongo: 'Classic / Steam Bongo Cat',
      rows: [
        ['License & Pricing', '<span class="badge-yes">100% Free · MIT Open Source (No IAP / Ads)</span>', '<span class="badge-mid">Closed-source or legacy forks (some with loot/IAP)</span>'],
        ['3D + 2D Dual Engine', '<span class="badge-yes">Instant 3D Figurine + 2D Classic switch + 360° orbit</span>', '<span class="badge-no">2D static sprites only</span>'],
        ['Size & Efficiency', '<span class="badge-yes">2.40 MB Tauri v2 + Rust · auto 30 FPS game eco mode</span>', '<span class="badge-mid">60–180 MB; higher idle GPU/CPU on many clones</span>'],
        ['Cross-Platform', '<span class="badge-yes">Win 11/10/7 · macOS (M1–M4/Intel/Homebrew) · Linux · Android</span>', '<span class="badge-no">Mostly Windows-only</span>'],
        ['Keyboard & Mouse', '<span class="badge-yes">65% / 108-key + Cat/Viewer view + L/R/M mouse + tail-key slaps</span>', '<span class="badge-mid">Fixed key overlay or basic 2-paw tap</span>'],
        ['Password Privacy Guard', '<span class="badge-yes">OS-level detection auto-closes eyes & masks keys</span>', '<span class="badge-no">Not supported</span>'],
        ['OBS Overlay', '<span class="badge-yes">Native Alpha Browser Source (no green screen) + OBS-Only mode</span>', '<span class="badge-mid">Requires chroma-key green screen or window capture</span>'],
        ['AI Companion & MCP', '<span class="badge-yes">Built-in MCP (22 facial sculpting params) + Claude/Codex hooks</span>', '<span class="badge-no">Not supported</span>'],
      ],
      whyTitle: 'Why Streamers, Coders & Gamers Switch to KuroCat',
      cards: [
        ['🙈 Automatic Password Privacy', 'On Windows and macOS, focusing any password field automatically makes KuroCat close its eyes and hide all keycap indicators — even inside OBS streams.'],
        ['⚡ Ultra-Light 2.40 MB Rust Core', 'GPU-batched 3D keycap atlas cuts active GPU usage by ~75%, drops to 30 FPS automatically during games, and includes a one-click Anti-Cheat Safe Pause in the tray.'],
        ['🎨 Built-in MCP AI Pet Studio', 'Customize 5 face shapes, 7 ear shapes (including Scottish Fold & floppy ears), 5 pupil styles, heterochromia odd eyes, blep tongue, and spots in 0.4s via Claude or Cursor.'],
      ],
      faqs: [
        { q: 'Is KuroCat a completely free Bongo Cat alternative?', a: 'Yes. KuroCat is MIT-licensed open-source software with zero paywalls, zero ads, and full source code available on github.com/qianyiai/KuroCat.' },
        { q: 'Is there a Bongo Cat alternative for macOS Apple Silicon (M1–M4)?', a: 'Yes. KuroCat runs natively on Apple Silicon and Intel Macs via Universal DMG or brew install --cask qianyiai/tap/kurocat.' },
        { q: 'Does KuroCat work as an OBS overlay without a green screen?', a: 'Yes. KuroCat includes a built-in local Browser Source (http://127.0.0.1:27421/obs) with true Alpha transparency and an optional OBS-Only mode.' },
      ],
    },
    ja: {
      title: 'KuroCat vs Bongo Cat — 無料オープンソース 3D Bongo Cat 代替アプリ徹底比較',
      description: 'KuroCat と従来の Bongo Cat を徹底比較：MIT オープンソース無料、3D/2D デュアルエンジン、2.40 MB 軽量 Rust 実装、macOS (M1–M4/Homebrew)＆Linux 対応、パスワード自動目隠し、クロマキー不要 OBS 透過ソース、MCP AI カスタム。',
      eyebrow: 'Comparison · Bongo Cat 代替アプリ比較',
      h1: 'KuroCat vs Bongo Cat 徹底比較',
      lead: '3D 表示・Mac / Linux 対応・パスワード保護・クロマキー不要の OBS 透過配信をすべて無料で備えた、Bongo Cat のモダンなオープンソース代替です。',
      breadcrumb: 'vs Bongo Cat',
      tblTitle: '機能・パフォーマンス比較表',
      colFeat: '比較項目',
      colKuro: 'KuroCat（公式オープンソース）',
      colBongo: '従来の Bongo Cat',
      rows: [
        ['ライセンス・料金', '<span class="badge-yes">完全無料 · MIT オープンソース（広告・課金ゼロ）</span>', '<span class="badge-mid">クローズドソースや一部課金あり</span>'],
        ['3D / 2D デュアル切替', '<span class="badge-yes">3D フィギュア ⇄ 2D クラシック即切替（360° 回転可）</span>', '<span class="badge-no">2D のみ</span>'],
        ['容量と軽さ', '<span class="badge-yes">2.40 MB (Tauri v2 + Rust) · ゲーム時 30 FPS 省電力</span>', '<span class="badge-mid">60〜180 MB クラスが多い</span>'],
        ['対応 OS', '<span class="badge-yes">Win11/10/7 · macOS (M1–M4/Homebrew) · Linux · Android</span>', '<span class="badge-no">多くが Windows のみ</span>'],
        ['パスワード自動保護', '<span class="badge-yes">OS 検知で自動目閉じ＆キー非表示（OBS 連動）</span>', '<span class="badge-no">非対応</span>'],
        ['OBS 透過ソース', '<span class="badge-yes">内蔵ブラウザソース（クロマキー不要・OBS 専用表示）</span>', '<span class="badge-mid">グリーンバック合成が必要</span>'],
        ['AI 連携 & MCP 造形', '<span class="badge-yes">22 項目顔カスタム（オッドアイ・垂れ耳等）＆Claude/Codex 連携</span>', '<span class="badge-no">非対応</span>'],
      ],
      whyTitle: 'KuroCat が選ばれる 3 つの理由',
      cards: [
        ['🙈 配信中のパスワード入力も安心', 'パスワード欄にフォーカスすると自動で目を閉じキー表示を隠すため、OBS 配信や画面共有でも安全です。'],
        ['⚡ ゲームを邪魔しない超軽量設計', 'ゲーム検知で自動 30 FPS 省電力へ切替。アンチチート保護のためトレイからワンクリックでフック停止も可能です。'],
        ['🎨 写真から AI が 0.4 秒で再現', '内蔵 MCP で輪郭・耳型（スコティッシュ折れ耳/垂れ耳）・瞳・オッドアイ・舌出しまで自在にカスタムできます。'],
      ],
      faqs: [
        { q: 'Mac で動く Bongo Cat の代替はありますか？', a: 'はい。KuroCat は Apple Silicon (M1〜M4) と Intel Mac にネイティブ対応し、brew install --cask qianyiai/tap/kurocat で 1 行導入できます。' },
        { q: 'KuroCat は本当に完全無料ですか？', a: 'はい、MIT ライセンスの完全無料オープンソースです。全ソースコードが github.com/qianyiai/KuroCat で公開されています。' },
      ],
    },
    ko: {
      title: 'KuroCat vs Bongo Cat — 무료 오픈소스 3D Bongo Cat 대안 완벽 비교',
      description: 'KuroCat과 기존 Bongo Cat 전격 비교: MIT 무료 오픈소스, 3D/2D 듀얼 엔진, 2.40 MB 초경량 Rust 빌드, macOS(Homebrew)·Linux 지원, 비밀번호 자동 눈 가리기, 크로마키 없는 OBS 투명 소스, AI MCP 커스텀.',
      eyebrow: 'Comparison · 무료 오픈소스 Bongo Cat 대안',
      h1: 'KuroCat vs Bongo Cat 핵심 기능 비교',
      lead: '3D 피규어 모드, macOS/Linux 기본 지원, 비밀번호 자동 눈 가리기, 크로마키 없는 OBS 투명 방송까지 모두 무료 오픈소스로 제공하는 차세대 Bongo Cat 대안입니다.',
      breadcrumb: 'vs Bongo Cat',
      tblTitle: '항목별 상세 비교',
      colFeat: '비교 항목',
      colKuro: 'KuroCat (공식 오픈소스)',
      colBongo: '기존 / Steam Bongo Cat',
      rows: [
        ['라이선스 및 가격', '<span class="badge-yes">100% 무료 · MIT 오픈소스 (광고/결제 없음)</span>', '<span class="badge-mid">비공개 소스 또는 일부 유료/뽑기 요소</span>'],
        ['3D + 2D 듀얼 엔진', '<span class="badge-yes">3D 피규어 ⇄ 2D 클래식 원클릭 전환 (360° 회전)</span>', '<span class="badge-no">2D 평면만 지원</span>'],
        ['용량 및 리소스', '<span class="badge-yes">2.40 MB (Tauri v2 + Rust) · 게임 시 자동 30 FPS 절전</span>', '<span class="badge-mid">60~180 MB, 일부 클론은 유휴 시에도 높은 GPU 점유</span>'],
        ['크로스 플랫폼', '<span class="badge-yes">Win 11/10/7 · macOS (M1–M4/Homebrew) · Linux · Android</span>', '<span class="badge-no">대부분 Windows 전용</span>'],
        ['비밀번호 눈 가리기', '<span class="badge-yes">OS 레벨 자동 감지로 눈 가리기 & 키 숨김</span>', '<span class="badge-no">미지원</span>'],
        ['OBS 투명 오버레이', '<span class="badge-yes">로컬 알파 투명 브라우저 소스 기본 내장 (크로마키 불필요)</span>', '<span class="badge-mid">그린스크린 크로마키 필요</span>'],
        ['AI 컴패니언 & MCP', '<span class="badge-yes">22종 얼굴 커스텀(오드아이·접힌 귀 등) + Claude/Codex 연동</span>', '<span class="badge-no">미지원</span>'],
      ],
      whyTitle: '스트리머와 개발자가 KuroCat을 선택하는 이유',
      cards: [
        ['🙈 방송 중 비밀번호 입력도 안전하게', '비밀번호 입력창에 포커스가 가면 자동으로 눈을 가리고 키캡 표시를 숨겨 OBS 방송에서도 안전합니다.'],
        ['⚡ 게임 프레임을 지키는 초경량 Rust 코어', '게임 실행 시 자동 30 FPS 절전 모드로 전환되며, 안티치트 게임 전 트레이에서 원클릭 일시정지도 지원합니다.'],
        ['🎨 반려묘 사진으로 0.4초 AI 커스텀', '내장 MCP 서버로 얼굴형, 7가지 귀 모양(폴드/처진 귀), 오드아이, 혀 내밀기(blep)까지 자유롭게 제작할 수 있습니다.'],
      ],
      faqs: [
        { q: '맥북(Apple Silicon M1~M4)에서도 쓸 수 있는 Bongo Cat 대안인가요?', a: '네, KuroCat은 Apple Silicon과 Intel Mac을 모두 네이티브 지원하며 brew install --cask qianyiai/tap/kurocat으로 한 줄 설치가 가능합니다.' },
        { q: 'OBS에서 그린스크린 없이 투명하게 띄울 수 있나요?', a: '네, 앱 내장 브라우저 소스(http://127.0.0.1:27421/obs)를 추가하면 크로마키 없이 완벽한 알파 투명 채널로 방송에 넣을 수 있습니다.' },
      ],
    },
    es: {
      title: 'KuroCat vs Bongo Cat — La mejor alternativa 3D gratis y open source a Bongo Cat (Win/Mac/Linux)',
      description: 'Compara KuroCat con Bongo Cat clásico y Steam Bongo Cat: licencia MIT open source, motor dual 3D + 2D, instalador Rust/Tauri de 2.40 MB, macOS (Homebrew) y Linux nativos, modo privacidad de contraseñas, overlay OBS sin croma y estudio MCP con IA.',
      eyebrow: 'Comparativa · Alternativa open source a Bongo Cat',
      h1: 'KuroCat vs Bongo Cat: comparativa completa',
      lead: '¿Buscas una alternativa moderna, ligera y de código abierto a Bongo Cat que funcione de forma nativa en Windows, macOS (M1–M4) y Linux — con renderizado 3D, privacidad de contraseñas y transparencia alfa en OBS?',
      breadcrumb: 'vs Bongo Cat',
      tblTitle: 'Comparativa función por función',
      colFeat: 'Función',
      colKuro: 'KuroCat (Oficial Open Source)',
      colBongo: 'Bongo Cat clásico / Steam',
      rows: [
        ['Licencia y precio', '<span class="badge-yes">100% gratis · MIT Open Source (sin compras ni anuncios)</span>', '<span class="badge-mid">Código cerrado o forks antiguos (algunos con cajas/pagos)</span>'],
        ['Motor dual 3D + 2D', '<span class="badge-yes">Cambio instantáneo entre figura 3D y 2D clásico + giro 360°</span>', '<span class="badge-no">Solo sprites 2D planos</span>'],
        ['Tamaño y eficiencia', '<span class="badge-yes">2.40 MB Tauri v2 + Rust · modo ahorro 30 FPS automático en juegos</span>', '<span class="badge-mid">60–180 MB; mayor uso de GPU/CPU en reposo en muchos clones</span>'],
        ['Multiplataforma', '<span class="badge-yes">Win 11/10/7 · macOS (M1–M4/Intel/Homebrew) · Linux · Android</span>', '<span class="badge-no">Mayormente solo Windows</span>'],
        ['Teclado y ratón', '<span class="badge-yes">65% / 108 teclas + vista gato/espectador + ratón I/D/C + cola</span>', '<span class="badge-mid">Teclas fijas o animación básica con dos patas</span>'],
        ['Privacidad de contraseñas', '<span class="badge-yes">Detección del sistema: cierra los ojos y oculta teclas automáticamente</span>', '<span class="badge-no">No compatible</span>'],
        ['Overlay OBS', '<span class="badge-yes">Fuente de navegador Alpha nativa (sin pantalla verde) + modo Solo OBS</span>', '<span class="badge-mid">Requiere croma verde o captura de ventana</span>'],
        ['Compañero IA y MCP', '<span class="badge-yes">MCP integrado (22 parámetros faciales) + hooks Claude/Codex</span>', '<span class="badge-no">No compatible</span>'],
      ],
      whyTitle: 'Por qué streamers, desarrolladores y gamers cambian a KuroCat',
      cards: [
        ['🙈 Privacidad automática de contraseñas', 'En Windows y macOS, al enfocar cualquier campo de contraseña, KuroCat cierra los ojos automáticamente y oculta todas las teclas y burbujas — incluso en directos de OBS.'],
        ['⚡ Núcleo Rust ultraligero de 2.40 MB', 'El atlas 3D por lotes en GPU reduce ~75% la carga activa, baja automáticamente a 30 FPS al jugar e incluye pausa segura anti-cheat en un clic desde la bandeja.'],
        ['🎨 Estudio de mascotas IA con MCP integrado', 'Personaliza 5 formas de rostro, 7 tipos de orejas (incluidas dobladas y caídas), 5 pupilas, heterocromía, lengüita blep y manchas en 0.4 s con Claude o Cursor.'],
      ],
      faqs: [
        { q: '¿KuroCat es una alternativa totalmente gratuita a Bongo Cat?', a: 'Sí. KuroCat es software de código abierto bajo licencia MIT, sin pagos ocultos ni anuncios, con todo el código fuente público en github.com/qianyiai/KuroCat.' },
        { q: '¿Existe una alternativa a Bongo Cat para macOS Apple Silicon (M1–M4)?', a: 'Sí. KuroCat funciona de forma nativa en Macs Apple Silicon e Intel mediante DMG universal o brew install --cask qianyiai/tap/kurocat.' },
        { q: '¿KuroCat funciona como overlay de OBS sin pantalla verde?', a: 'Sí. KuroCat integra una fuente de navegador local (http://127.0.0.1:27421/obs) con canal Alpha real y modo opcional Solo OBS.' },
      ],
    },
    pt: {
      title: 'KuroCat vs Bongo Cat — Melhor alternativa 3D grátis e open source ao Bongo Cat (Win/Mac/Linux)',
      description: 'Compare o KuroCat com o Bongo Cat clássico e da Steam: código aberto MIT, motor duplo 3D + 2D, 2,40 MB em Rust/Tauri, macOS (Homebrew) e Linux nativos, proteção automática de senhas, overlay OBS sem chroma key e estúdio MCP com IA.',
      eyebrow: 'Comparativo · Alternativa open source ao Bongo Cat',
      h1: 'KuroCat vs Bongo Cat: comparativo completo',
      lead: 'Procurando uma alternativa moderna, leve e open source ao Bongo Cat que rode nativamente no Windows, macOS (M1–M4) e Linux — com 3D, privacidade de senhas e transparência alfa no OBS?',
      breadcrumb: 'vs Bongo Cat',
      tblTitle: 'Comparação recurso por recurso',
      colFeat: 'Recurso',
      colKuro: 'KuroCat (Oficial Open Source)',
      colBongo: 'Bongo Cat clássico / Steam',
      rows: [
        ['Licença e preço', '<span class="badge-yes">100% grátis · MIT Open Source (sem compras/anúncios)</span>', '<span class="badge-mid">Código fechado ou forks antigos (alguns com loots/IAP)</span>'],
        ['Motor duplo 3D + 2D', '<span class="badge-yes">Troca instantânea entre 3D e 2D clássico + órbita 360°</span>', '<span class="badge-no">Apenas sprites 2D estáticos</span>'],
        ['Tamanho e leveza', '<span class="badge-yes">2,40 MB Tauri v2 + Rust · modo eco 30 FPS automático em jogos</span>', '<span class="badge-mid">60–180 MB; maior uso de GPU/CPU em repouso em vários clones</span>'],
        ['Multiplataforma', '<span class="badge-yes">Win 11/10/7 · macOS (M1–M4/Intel/Homebrew) · Linux · Android</span>', '<span class="badge-no">Quase sempre só Windows</span>'],
        ['Teclado e mouse', '<span class="badge-yes">65% / 108 teclas + vista gato/público + mouse E/D/M + cauda</span>', '<span class="badge-mid">Teclas fixas ou batida simples com duas patas</span>'],
        ['Proteção de senhas', '<span class="badge-yes">Detecção no nível do SO: fecha os olhos e oculta teclas</span>', '<span class="badge-no">Não suportado</span>'],
        ['Overlay no OBS', '<span class="badge-yes">Fonte de Navegador Alpha nativa (sem fundo verde) + modo Só OBS</span>', '<span class="badge-mid">Exige chroma key verde ou captura de janela</span>'],
        ['Companheiro IA e MCP', '<span class="badge-yes">MCP embutido (22 parâmetros faciais) + hooks Claude/Codex</span>', '<span class="badge-no">Não suportado</span>'],
      ],
      whyTitle: 'Por que streamers, devs e gamers migram para o KuroCat',
      cards: [
        ['🙈 Privacidade automática ao digitar senhas', 'No Windows e macOS, ao focar qualquer campo de senha o KuroCat fecha os olhos automaticamente e oculta teclas e bolhas — inclusive nas lives no OBS.'],
        ['⚡ Núcleo Rust ultraleve de 2,40 MB', 'O atlas 3D em lote na GPU reduz o consumo ativo em ~75%, cai automaticamente para 30 FPS em jogos e traz pausa segura anti-cheat em um clique na bandeja.'],
        ['🎨 Estúdio de pets com IA via MCP nativo', 'Personalize 5 formatos de rosto, 7 tipos de orelhas (dobradas e caídas), 5 pupilas, heterocromia, linguinha blep e manchas em 0,4 s via Claude ou Cursor.'],
      ],
      faqs: [
        { q: 'O KuroCat é uma alternativa totalmente gratuita ao Bongo Cat?', a: 'Sim. O KuroCat tem licença MIT de código aberto, sem paywalls ou anúncios, com todo o código disponível em github.com/qianyiai/KuroCat.' },
        { q: 'Existe alternativa ao Bongo Cat para macOS Apple Silicon (M1–M4)?', a: 'Sim. O KuroCat roda nativamente em Macs Apple Silicon e Intel via DMG universal ou brew install --cask qianyiai/tap/kurocat.' },
        { q: 'O KuroCat funciona como overlay no OBS sem chroma key?', a: 'Sim. Ele inclui uma Fonte de Navegador local (http://127.0.0.1:27421/obs) com transparência Alpha real e modo opcional Só OBS.' },
      ],
    },
    ru: {
      title: 'KuroCat vs Bongo Cat — Лучшая бесплатная 3D-альтернатива Bongo Cat с открытым кодом (Win/Mac/Linux)',
      description: 'Сравнение KuroCat с классическим и Steam Bongo Cat: лицензия MIT, движок 3D + 2D, 2,40 МБ на Rust/Tauri, нативные macOS (Homebrew) и Linux, защита паролей, прозрачный оверлей OBS без хромакея и встроенная ИИ-студия MCP.',
      eyebrow: 'Сравнение · Открытая альтернатива Bongo Cat',
      h1: 'KuroCat vs Bongo Cat: подробное сравнение',
      lead: 'Ищете современную, лёгкую и открытую альтернативу Bongo Cat с нативной поддержкой Windows, macOS (M1–M4) и Linux — с 3D-режимом, скрытием паролей и прозрачностью Alpha в OBS?',
      breadcrumb: 'vs Bongo Cat',
      tblTitle: 'Построчное сравнение возможностей',
      colFeat: 'Функция',
      colKuro: 'KuroCat (Официальный Open Source)',
      colBongo: 'Классический / Steam Bongo Cat',
      rows: [
        ['Лицензия и цена', '<span class="badge-yes">100% бесплатно · MIT Open Source (без доната и рекламы)</span>', '<span class="badge-mid">Закрытый код или старые форки (местами с кейсами/донатом)</span>'],
        ['Двойной движок 3D + 2D', '<span class="badge-yes">Мгновенное переключение 3D-фигурки и 2D-классики + обзор 360°</span>', '<span class="badge-no">Только плоские 2D-спрайты</span>'],
        ['Размер и нагрузка', '<span class="badge-yes">2,40 МБ Tauri v2 + Rust · авто-режим 30 FPS в играх</span>', '<span class="badge-mid">60–180 МБ; повышенная нагрузка на GPU/CPU в простое</span>'],
        ['Кроссплатформенность', '<span class="badge-yes">Win 11/10/7 · macOS (M1–M4/Intel/Homebrew) · Linux · Android</span>', '<span class="badge-no">В основном только Windows</span>'],
        ['Клавиатура и мышь', '<span class="badge-yes">65% / 108 клавиш + 2 ракурса + ЛКМ/ПКМ/СКМ + удар хвостом</span>', '<span class="badge-mid">Фиксированный набор или простые хлопки двумя лапами</span>'],
        ['Защита паролей', '<span class="badge-yes">Системное определение поля пароля: закрывает глаза и скрывает клавиши</span>', '<span class="badge-no">Не поддерживается</span>'],
        ['Оверлей для OBS', '<span class="badge-yes">Встроенный Alpha-источник браузера (без хромакея) + режим «Только OBS»</span>', '<span class="badge-mid">Требуется зелёный фон (хромакей) или захват окна</span>'],
        ['ИИ-компаньон и MCP', '<span class="badge-yes">Встроенный MCP (22 параметра внешности) + хуки Claude/Codex</span>', '<span class="badge-no">Не поддерживается</span>'],
      ],
      whyTitle: 'Почему стримеры, разработчики и геймеры переходят на KuroCat',
      cards: [
        ['🙈 Автоматическая защита паролей', 'В Windows и macOS при фокусе на любом поле пароля KuroCat сам закрывает глаза и скрывает подсветку клавиш и всплывающие подсказки — в том числе на стриме в OBS.'],
        ['⚡ Сверхлёгкое ядро Rust на 2,40 МБ', 'Батчинг 3D-клавиш на GPU снижает нагрузку на ~75%, в играх автоматически включается экономный режим 30 FPS, а в трее есть безопасная пауза для античитов в один клик.'],
        ['🎨 Встроенная ИИ-студия питомцев MCP', 'Настраивайте 5 форм мордочки, 7 типов ушей (включая вислоухих), 5 видов зрачков, гетерохромию, высунутый язычок и пятна за 0,4 с через Claude или Cursor.'],
      ],
      faqs: [
        { q: 'KuroCat действительно полностью бесплатная альтернатива Bongo Cat?', a: 'Да. KuroCat распространяется под свободной лицензией MIT без рекламы и встроенных покупок, а весь исходный код открыт на github.com/qianyiai/KuroCat.' },
        { q: 'Есть ли альтернатива Bongo Cat для macOS Apple Silicon (M1–M4)?', a: 'Да. KuroCat нативно работает на Mac с Apple Silicon и Intel — через универсальный DMG или brew install --cask qianyiai/tap/kurocat.' },
        { q: 'Работает ли KuroCat в OBS без зелёного фона (хромакея)?', a: 'Да. В приложение встроен локальный источник браузера (http://127.0.0.1:27421/obs) с настоящей альфа-прозрачностью и режимом «Только OBS».' },
      ],
    },
    de: {
      title: 'KuroCat vs Bongo Cat — Beste kostenlose Open-Source-3D-Alternative zu Bongo Cat (Win/Mac/Linux)',
      description: 'KuroCat im Vergleich zu klassischem und Steam Bongo Cat: MIT Open Source, 3D-Figur + 2D-Dual-Engine, 2,40 MB Rust/Tauri-Build, natives macOS (Homebrew) & Linux, Passwort-Privatsphärenschutz, OBS-Alpha-Overlay ohne Greenscreen und MCP-KI-Studio.',
      eyebrow: 'Vergleich · Kostenlose Open-Source-Alternative zu Bongo Cat',
      h1: 'KuroCat vs Bongo Cat: Der vollständige Vergleich',
      lead: 'Du suchst eine moderne, ressourcenschonende Open-Source-Alternative zu Bongo Cat, die nativ auf Windows, macOS (M1–M4) und Linux läuft — mit 3D-Darstellung, Passwortschutz und echtem OBS-Alpha-Overlay?',
      breadcrumb: 'vs Bongo Cat',
      tblTitle: 'Funktion für Funktion im Vergleich',
      colFeat: 'Funktion',
      colKuro: 'KuroCat (Offiziell Open Source)',
      colBongo: 'Klassisches / Steam Bongo Cat',
      rows: [
        ['Lizenz & Preis', '<span class="badge-yes">100 % kostenlos · MIT Open Source (ohne In-App-Käufe / Werbung)</span>', '<span class="badge-mid">Closed Source oder alte Forks (teils mit Loot/Käufen)</span>'],
        ['3D- & 2D-Dual-Engine', '<span class="badge-yes">Sofortiger Wechsel zwischen 3D-Figur & 2D-Klassik + 360°-Drehung</span>', '<span class="badge-no">Nur statische 2D-Sprites</span>'],
        ['Größe & Effizienz', '<span class="badge-yes">2,40 MB Tauri v2 + Rust · automatischer 30-FPS-Spiel-Sparmodus</span>', '<span class="badge-mid">60–180 MB; bei vielen Klonen höhere GPU-/CPU-Last im Leerlauf</span>'],
        ['Plattformen', '<span class="badge-yes">Win 11/10/7 · macOS (M1–M4/Intel/Homebrew) · Linux · Android</span>', '<span class="badge-no">Meist nur Windows</span>'],
        ['Tastatur & Maus', '<span class="badge-yes">65 % / 108 Tasten + 2 Perspektiven + L/R/M-Maus + Schweif-Tasten</span>', '<span class="badge-mid">Festes Layout oder einfaches Zweipfoten-Tippen</span>'],
        ['Passwort-Schutz', '<span class="badge-yes">OS-Erkennung schließt automatisch Augen & blendet Tasten aus</span>', '<span class="badge-no">Nicht unterstützt</span>'],
        ['OBS-Overlay', '<span class="badge-yes">Native Alpha-Browser-Quelle (ohne Greenscreen) + Nur-OBS-Modus</span>', '<span class="badge-mid">Erfordert Greenscreen-Chroma-Key oder Fensteraufnahme</span>'],
        ['KI-Begleiter & MCP', '<span class="badge-yes">Integrierter MCP (22 Gesichtsparameter) + Claude/Codex-Hooks</span>', '<span class="badge-no">Nicht unterstützt</span>'],
      ],
      whyTitle: 'Warum Streamer, Entwickler und Gamer zu KuroCat wechseln',
      cards: [
        ['🙈 Automatischer Passwort-Sichtschutz', 'Unter Windows und macOS erkennt KuroCat Passwortfelder auf Systemebene, schließt automatisch die Augen und blendet alle Tastenanzeigen aus — auch live in OBS.'],
        ['⚡ Ultraleichter 2,40-MB-Rust-Kern', 'GPU-gebatchte 3D-Tastenkappen senken die aktive GPU-Last um ~75 %, drosseln im Spiel automatisch auf 30 FPS und bieten im Tray eine Ein-Klick-Anti-Cheat-Pause.'],
        ['🎨 Integriertes MCP-KI-Studio', 'Passe 5 Gesichtsformen, 7 Ohrformen (inkl. Faltohren & Schlappohren), 5 Pupillenstile, Heterochromie, Blep-Zunge und Flecken in 0,4 s per Claude oder Cursor an.'],
      ],
      faqs: [
        { q: 'Ist KuroCat eine komplett kostenlose Alternative zu Bongo Cat?', a: 'Ja. KuroCat ist MIT-lizenzierte Open-Source-Software ohne Paywalls oder Werbung; der vollständige Quellcode liegt auf github.com/qianyiai/KuroCat.' },
        { q: 'Gibt es eine Bongo-Cat-Alternative für macOS Apple Silicon (M1–M4)?', a: 'Ja. KuroCat läuft nativ auf Apple-Silicon- und Intel-Macs per Universal-DMG oder brew install --cask qianyiai/tap/kurocat.' },
        { q: 'Funktioniert KuroCat als OBS-Overlay ganz ohne Greenscreen?', a: 'Ja. KuroCat enthält eine lokale Browser-Quelle (http://127.0.0.1:27421/obs) mit echter Alpha-Transparenz und optionalem Nur-OBS-Modus.' },
      ],
    },
  }[locale];

  const bodyHtml = `
    <section class="card">
      <h2>${esc(copy.tblTitle)}</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>${esc(copy.colFeat)}</th><th>${esc(copy.colKuro)}</th><th>${esc(copy.colBongo)}</th></tr></thead>
          <tbody>
            ${copy.rows.map((r) => `<tr><td><strong>${esc(r[0])}</strong></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('\n            ')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>${esc(copy.whyTitle)}</h2>
      <div class="grid-3">
        ${copy.cards.map((c) => `<div class="mini-card"><h3>${esc(c[0])}</h3><p>${esc(c[1])}</p></div>`).join('\n        ')}
      </div>
    </section>
  `;

  return renderPage({
    locale,
    slug: 'vs/bongo-cat',
    title: copy.title,
    description: copy.description,
    eyebrow: copy.eyebrow,
    h1: copy.h1,
    lead: copy.lead,
    breadcrumbLabel: copy.breadcrumb,
    bodyHtml,
    faqs: copy.faqs,
    today,
  });
}

function buildObsPage(locale, today) {
  const nav = NAV_I18N[locale];
  const obsUrl = 'http://127.0.0.1:27421/obs';
  const copy = {
    zh: {
      title: 'KuroCat OBS 透明直播源教程 — 免绿幕抠像 3 步添加 3D/2D 打字小黑猫',
      description: '无需绿幕色度抠像！3 步把 KuroCat 透明打字小黑猫接入 OBS Studio / 抖音直播伴侣 / B站直播姬：原生 Alpha 透明通道、支持「仅 OBS 显示」与输密码自动闭眼同步。',
      eyebrow: 'OBS Studio · Zero Chroma-Key Alpha Overlay',
      h1: 'OBS 免绿幕透明打字猫：3 步极速接入',
      lead: 'KuroCat 原生内置本机透明浏览器源（默认关闭零开销），直接输出纯 Alpha 透明通道，告别绿幕溢色与锯齿边缘，完美适配 OBS Studio、Streamlabs、B 站直播姬与抖音直播伴侣。',
      breadcrumb: 'OBS 直播源',
      stepsTitle: '3 步完成 OBS 透明源配置',
      steps: [
        { name: '开启并复制本机 OBS 地址', text: '启动 KuroCat 后，右键点击桌面小猫或右下角系统托盘，选择「复制 OBS 透明源地址」（自动启动本机服务 http://127.0.0.1:27421/obs，不联网、零外泄）。' },
        { name: '在 OBS 中添加「浏览器」来源', text: '打开 OBS Studio → 来源栏点「+」→ 选择「浏览器 (Browser)」→ URL 粘贴 http://127.0.0.1:27421/obs，建议画布尺寸设为 800 × 600（或按需缩放），无需任何色度键滤镜。' },
        { name: '按需开启「仅 OBS 显示」与密码保护', text: '如果不想桌面上遮挡游戏画面，可在托盘勾选「仅 OBS 显示」隐藏桌面猫，OBS 直播画面依然 60fps 实时同步打字、鼠标左右键、AI 状态与输密码自动闭眼！' },
      ],
      extraTitle: '抖音直播伴侣 / 窗口捕获补充方案（KuroCat Live）',
      extraBody: '部分直播工具（如抖音直播伴侣）如果不支持透明浏览器源，KuroCat 同样内置了「直播伴侣绿/蓝/品红幕捕获窗口（KuroCat Live）」，右键菜单或托盘一键开启纯色无边框捕获窗口，配合色度抠像同样清晰丝滑。',
      faqs: [
        { q: '为什么 OBS 添加后没有绿底、也不用加色度键滤镜？', a: '因为 http://127.0.0.1:27421/obs 直接渲染在带原生 Alpha 透明通道的网页画布上，OBS 浏览器源原生支持透明背景，边缘抗锯齿比绿幕抠像干净得多。' },
        { q: '直播时输入密码会被观众看到按键吗？', a: '不会。KuroCat 在检测到 Windows / macOS 密码输入框时会自动进入防偷窥状态，OBS 透明源会实时同步闭眼（大肥鱼捂眼）并完全屏蔽按键与气泡。' },
        { q: '平时不直播时开启 OBS 服务会占资源吗？', a: 'OBS 透明源服务默认关闭（零线程、零端口开销），仅在你主动开启或点击复制地址后才在 127.0.0.1 本机监听。' },
      ],
    },
    en: {
      title: 'KuroCat OBS Transparent Keyboard Cat Overlay — 3-Step Zero Chroma-Key Setup',
      description: 'Add a free 3D/2D typing cat overlay to OBS Studio without green screen chroma-key. Built-in local Browser Source (http://127.0.0.1:27421/obs) with true Alpha transparency, OBS-Only mode, and synced password privacy.',
      eyebrow: 'OBS Studio · Zero Chroma-Key Alpha Overlay',
      h1: 'OBS Transparent Typing Cat Overlay in 3 Steps',
      lead: 'Skip ugly green-screen fringes. KuroCat ships with a built-in local Browser Source (off by default with zero overhead) delivering true Alpha transparency for OBS Studio, Twitch, YouTube, and Kick streams.',
      breadcrumb: 'OBS Overlay',
      stepsTitle: '3-Step OBS Browser Source Setup',
      steps: [
        { name: 'Copy the Local OBS Source URL', text: 'Right-click KuroCat (or its system tray icon) and click "Copy OBS Transparent Source URL". This enables the loopback-only server at http://127.0.0.1:27421/obs.' },
        { name: 'Add a Browser Source in OBS Studio', text: 'In OBS Studio click "+" under Sources → Browser → paste http://127.0.0.1:27421/obs and set Width 800, Height 600. No Chroma Key filter needed!' },
        { name: 'Optional: Enable OBS-Only Mode', text: 'Want a clean desktop while streaming? Toggle "OBS-Only Mode" to hide the desktop cat while keeping the OBS overlay running live with synced password privacy guard.' },
      ],
      extraTitle: 'Chroma-Key Window Capture Fallback (KuroCat Live)',
      extraBody: 'For streaming tools that do not support transparent Browser Sources, KuroCat also includes a borderless "KuroCat Live" capture window with switchable blue/green/magenta chroma backgrounds.',
      faqs: [
        { q: 'Does the OBS Browser Source send my keystrokes to the internet?', a: 'Never. The overlay server binds strictly to 127.0.0.1 (localhost only) and is disabled by default until you turn it on.' },
        { q: 'Does password privacy protection also work inside OBS?', a: 'Yes! Whenever you focus a Windows or macOS password field, the OBS overlay immediately closes the cat’s eyes and suppresses all key highlights and bubbles.' },
      ],
    },
    ja: {
      title: 'KuroCat OBS 透過タイピング猫オーバーレイ導入ガイド — クロマキー不要の 3 ステップ',
      description: 'グリーンバック不要！KuroCat の内蔵ブラウザソース（http://127.0.0.1:27421/obs）を使って OBS Studio に完全アルファ透過の 3D/2D 打鍵猫を 3 ステップで追加する方法。',
      eyebrow: 'OBS Studio · クロマキー不要アルファ透過',
      h1: 'OBS 透過タイピング猫オーバーレイ（3 ステップ導入）',
      lead: 'クロマキーの緑フチとはお別れ。KuroCat 内蔵のローカルブラウザソース（初期 OFF・負荷ゼロ）で、完全アルファ透過のまま OBS Studio に 60fps 表示できます。',
      breadcrumb: 'OBS 透過配信',
      stepsTitle: 'OBS ブラウザソース 3 ステップ設定',
      steps: [
        { name: 'ローカル OBS URL をコピー', text: 'KuroCat またはトレイを右クリックし「OBS 透過ソース URL をコピー」を選択します（ローカル限定 http://127.0.0.1:27421/obs が起動）。' },
        { name: 'OBS で「ブラウザ」ソースを追加', text: 'OBS Studio のソース「＋」→「ブラウザ」を選び、URL に http://127.0.0.1:27421/obs、サイズ 800×600 を入力します。クロマキーフィルタは不要です。' },
        { name: '必要に応じて「OBS のみ表示」をオン', text: 'デスクトップ側を隠したい場合は「OBS のみ表示」を有効化。パスワード入力時の自動目隠しも OBS 側へそのまま連動します。' },
      ],
      extraTitle: 'ウィンドウキャプチャ派向けのクロマキー専用窓（KuroCat Live）',
      extraBody: 'ブラウザソース非対応の配信ツール向けに、青/緑/マゼンタ背景を切り替えられるフレームレス専用窓「KuroCat Live」も内蔵しています。',
      faqs: [
        { q: 'OBS 配信中にパスワードを入力しても大丈夫ですか？', a: 'はい。OS のパスワード欄を検知すると OBS 側でも即座に目を閉じ、キー発光やバブルを完全に非表示にします。' },
        { q: 'ローカルサーバーは外部からアクセスされますか？', a: 'いいえ、127.0.0.1（自分自身の PC 内部）のみにバインドされ、初期状態では完全にオフです。' },
      ],
    },
    ko: {
      title: 'KuroCat OBS 투명 타이핑 고양이 오버레이 설정 — 크로마키 없는 3단계 가이드',
      description: '그린스크린 크로마키 없이 OBS Studio에 3D/2D 타이핑 고양이를 추가하세요. 내장 로컬 브라우저 소스(http://127.0.0.1:27421/obs)로 알파 투명 채널, OBS 전용 표시 및 비밀번호 눈 가리기를 완벽 지원합니다.',
      eyebrow: 'OBS Studio · 크로마키 없는 알파 투명 오버레이',
      h1: 'OBS 투명 타이핑 고양이 오버레이 3단계 설정',
      lead: '지저분한 초록 테두리 없이 깔끔하게! KuroCat 내장 로컬 브라우저 소스(기본 꺼짐·부하 0)로 OBS Studio, 치지직, 숲(아프리카TV), 트위치 방송에 바로 투명 오버레이를 띄울 수 있습니다.',
      breadcrumb: 'OBS 투명 오버레이',
      stepsTitle: 'OBS 브라우저 소스 3단계 연결',
      steps: [
        { name: '로컬 OBS 주소 복사', text: 'KuroCat 또는 트레이 아이콘을 우클릭해「OBS 투명 소스 주소 복사」를 누릅니다(로컬 전용 http://127.0.0.1:27421/obs 자동 시작).' },
        { name: 'OBS에서「브라우저」소스 추가', text: 'OBS Studio 소스「+」→「브라우저」선택 후 URL에 http://127.0.0.1:27421/obs, 너비 800 / 높이 600을 입력합니다. 크로마키 필터가 전혀 필요 없습니다.' },
        { name: '원하면「OBS 전용 표시」활성화', text: '게임 화면을 가리지 않으려면「OBS 전용 표시」로 바탕화면 펫을 숨기세요. OBS 방송 화면은 그대로 유지되며 비밀번호 눈 가리기도 실시간 연동됩니다.' },
      ],
      extraTitle: '윈도우 캡처용 크로마키 전용 창 (KuroCat Live)',
      extraBody: '브라우저 소스를 지원하지 않는 방송 프로그램을 위해 파랑/초록/마젠타 단색 배경의 테두리 없는 캡처 창(KuroCat Live)도 함께 제공합니다.',
      faqs: [
        { q: '방송 중 비밀번호를 입력해도 키가 노출되지 않나요?', a: '네, Windows/macOS 비밀번호 입력창이 감지되면 OBS 오버레이에서도 즉시 눈을 가리고 모든 키캡과 말풍선을 숨깁니다.' },
        { q: '키 입력 데이터가 외부 서버로 전송되나요?', a: '전혀 전송되지 않습니다. OBS 소스는 127.0.0.1 로컬 루프백에서만 동작하며 기본 상태에서는 꺼져 있습니다.' },
      ],
    },
    es: {
      title: 'Overlay transparente de KuroCat para OBS — Configuración en 3 pasos sin pantalla verde',
      description: 'Añade un gato 3D/2D que escribe en tiempo real a OBS Studio sin croma verde. Fuente de navegador local integrada (http://127.0.0.1:27421/obs) con transparencia Alpha real, modo Solo OBS y privacidad de contraseñas sincronizada.',
      eyebrow: 'OBS Studio · Overlay Alpha sin croma',
      h1: 'Overlay transparente de gato tecleando en OBS en 3 pasos',
      lead: 'Olvídate de los bordes verdes del croma. KuroCat incluye una fuente de navegador local (desactivada por defecto con gasto cero) que ofrece canal Alpha puro para directos en OBS Studio, Twitch, YouTube y Kick.',
      breadcrumb: 'Overlay OBS',
      stepsTitle: 'Configura la fuente de navegador en OBS en 3 pasos',
      steps: [
        { name: 'Copia la URL local de OBS', text: 'Haz clic derecho en KuroCat (o en su icono de la bandeja del sistema) y elige «Copiar URL de fuente transparente OBS». Esto activa el servidor estrictamente local en http://127.0.0.1:27421/obs.' },
        { name: 'Añade una fuente de Navegador en OBS Studio', text: 'En OBS Studio pulsa «+» en Fuentes → Navegador → pega http://127.0.0.1:27421/obs y ajusta el tamaño a 800 × 600. ¡No necesitas ningún filtro de fondo croma!' },
        { name: 'Opcional: activa el modo Solo OBS', text: '¿Prefieres el escritorio despejado mientras haces stream? Activa «Modo Solo OBS» para ocultar el gato del escritorio mientras el overlay de OBS sigue funcionando a 60 fps con protección de contraseñas sincronizada.' },
      ],
      extraTitle: 'Alternativa de captura de ventana con croma (KuroCat Live)',
      extraBody: 'Para programas de streaming que no admitan fuentes de navegador transparentes, KuroCat también integra la ventana sin bordes «KuroCat Live» con fondos sólidos intercambiables en azul, verde o magenta.',
      faqs: [
        { q: '¿La fuente de navegador OBS envía mis pulsaciones a internet?', a: 'Nunca. El servidor del overlay escucha exclusivamente en 127.0.0.1 (solo tu equipo) y permanece desactivado por defecto hasta que lo habilitas.' },
        { q: '¿La protección de contraseñas también funciona dentro de OBS?', a: 'Sí. En cuanto enfocas un campo de contraseña en Windows o macOS, el overlay de OBS cierra al instante los ojos del gato y oculta todas las teclas y burbujas.' },
        { q: '¿Consume recursos el servicio de OBS cuando no estoy en directo?', a: 'No. El servidor OBS está apagado por defecto (cero hilos y cero puertos abiertos) y solo se inicia cuando lo activas manualmente.' },
      ],
    },
    pt: {
      title: 'Overlay transparente do KuroCat no OBS — Configuração em 3 passos sem chroma key',
      description: 'Adicione um gato 3D/2D digitando no OBS Studio sem tela verde. Fonte de Navegador local embutida (http://127.0.0.1:27421/obs) com transparência Alpha real, modo Só OBS e proteção de senhas sincronizada.',
      eyebrow: 'OBS Studio · Overlay Alpha sem chroma key',
      h1: 'Overlay transparente de gato digitando no OBS em 3 passos',
      lead: 'Diga adeus às bordas verdes do chroma key. O KuroCat já vem com uma Fonte de Navegador local (desligada por padrão, zero impacto) entregando transparência Alpha pura para lives no OBS Studio, Twitch, YouTube e Kick.',
      breadcrumb: 'Overlay OBS',
      stepsTitle: 'Configure a Fonte de Navegador no OBS em 3 passos',
      steps: [
        { name: 'Copie a URL local do OBS', text: 'Clique com o botão direito no KuroCat (ou no ícone da bandeja) e escolha «Copiar URL da fonte transparente OBS». Isso ativa o servidor somente local em http://127.0.0.1:27421/obs.' },
        { name: 'Adicione uma fonte Navegador no OBS Studio', text: 'No OBS Studio clique em «+» em Fontes → Navegador → cole http://127.0.0.1:27421/obs e defina largura 800 e altura 600. Nenhum filtro Chroma Key é necessário!' },
        { name: 'Opcional: ative o modo Só OBS', text: 'Quer a área de trabalho limpa durante a live? Ative «Modo Só OBS» para esconder o pet da tela mantendo o overlay no OBS ao vivo, inclusive com a proteção de senhas sincronizada.' },
      ],
      extraTitle: 'Alternativa de captura de janela com chroma key (KuroCat Live)',
      extraBody: 'Para softwares de transmissão que não suportam Fontes de Navegador transparentes, o KuroCat também oferece a janela sem bordas «KuroCat Live» com fundos sólidos em azul, verde ou magenta.',
      faqs: [
        { q: 'A Fonte de Navegador do OBS envia minhas teclas para a internet?', a: 'Nunca. O servidor de overlay escuta estritamente em 127.0.0.1 (apenas localhost) e fica desativado por padrão até você ligá-lo.' },
        { q: 'A proteção de senhas também funciona dentro do OBS?', a: 'Sim! Sempre que você focar um campo de senha no Windows ou macOS, o overlay no OBS fecha imediatamente os olhos do gato e esconde teclas e bolhas.' },
        { q: 'O serviço do OBS consome recursos quando não estou em live?', a: 'Não. Ele permanece desligado por padrão (zero consumo de CPU/porta) e só inicia quando você ativa ou copia a URL.' },
      ],
    },
    ru: {
      title: 'Прозрачный оверлей KuroCat для OBS — Настройка за 3 шага без хромакея',
      description: 'Добавьте бесплатного 3D/2D-кота на клавиатуре в OBS Studio без зелёного фона. Встроенный локальный источник браузера (http://127.0.0.1:27421/obs) с настоящей альфа-прозрачностью, режимом «Только OBS» и синхронной защитой паролей.',
      eyebrow: 'OBS Studio · Alpha-оверлей без хромакея',
      h1: 'Прозрачный оверлей печатающего кота в OBS за 3 шага',
      lead: 'Забудьте про зелёную обводку хромакея. В KuroCat встроен локальный источник браузера (по умолчанию выключен — нулевая нагрузка) с чистым альфа-каналом для трансляций в OBS Studio, Twitch, YouTube и VK Play.',
      breadcrumb: 'Оверлей OBS',
      stepsTitle: 'Настройка источника браузера в OBS за 3 шага',
      steps: [
        { name: 'Скопируйте локальный URL для OBS', text: 'Нажмите правой кнопкой по KuroCat (или по иконке в трее) и выберите «Копировать URL прозрачного источника OBS». Локальный сервер автоматически запустится на http://127.0.0.1:27421/obs.' },
        { name: 'Добавьте источник «Браузер» в OBS Studio', text: 'В OBS Studio нажмите «+» в списке источников → «Браузер» → вставьте http://127.0.0.1:27421/obs и укажите ширину 800 и высоту 600. Фильтр хромакея не нужен!' },
        { name: 'По желанию включите режим «Только OBS»', text: 'Хотите оставить рабочий стол чистым во время стрима? Включите «Только OBS», чтобы скрыть питомца на экране, сохранив живой 60fps-оверлей в OBS с синхронной защитой паролей.' },
      ],
      extraTitle: 'Запасной вариант захвата окна с хромакеем (KuroCat Live)',
      extraBody: 'Для программ стриминга без поддержки прозрачных браузерных источников в KuroCat есть отдельное безрамочное окно «KuroCat Live» с переключаемым синим, зелёным или пурпурным фоном.',
      faqs: [
        { q: 'Отправляет ли источник OBS нажатия клавиш в интернет?', a: 'Никогда. Сервер оверлея привязан строго к 127.0.0.1 (только локальный ПК) и по умолчанию полностью выключен.' },
        { q: 'Работает ли скрытие паролей на самом стриме в OBS?', a: 'Да! Как только фокус попадает в поле пароля Windows или macOS, оверлей OBS мгновенно закрывает коту глаза и скрывает все клавиши и всплывающие подсказки.' },
        { q: 'Тратит ли сервер OBS ресурсы, когда я не стримлю?', a: 'Нет. Пока вы не включите его вручную, локальный сервер не запускается и не занимает ни потоков, ни портов.' },
      ],
    },
    de: {
      title: 'KuroCat OBS-Overlay ohne Greenscreen — Transparente Tipp-Katze in 3 Schritten einrichten',
      description: 'Füge OBS Studio kostenlos eine 3D/2D-Tipp-Katze ohne Chroma-Key hinzu. Integrierte lokale Browser-Quelle (http://127.0.0.1:27421/obs) mit echter Alpha-Transparenz, Nur-OBS-Modus und synchronem Passwortschutz.',
      eyebrow: 'OBS Studio · Alpha-Overlay ohne Chroma-Key',
      h1: 'Transparentes OBS-Overlay mit Tipp-Katze in 3 Schritten',
      lead: 'Schluss mit grünen Rändern beim Keying. KuroCat enthält eine lokale Browser-Quelle (standardmäßig aus, null Overhead) mit echter Alpha-Transparenz für Streams in OBS Studio, Twitch, YouTube und Kick.',
      breadcrumb: 'OBS-Overlay',
      stepsTitle: 'OBS-Browser-Quelle in 3 Schritten einrichten',
      steps: [
        { name: 'Lokale OBS-URL kopieren', text: 'Klicke mit rechts auf KuroCat (oder das Tray-Symbol) und wähle „Transparente OBS-Quellen-URL kopieren“. Dadurch startet der rein lokale Server unter http://127.0.0.1:27421/obs.' },
        { name: 'Browser-Quelle in OBS Studio hinzufügen', text: 'Klicke in OBS Studio bei Quellen auf „+“ → Browser → füge http://127.0.0.1:27421/obs ein und stelle 800 × 600 ein. Kein Chroma-Key-Filter nötig!' },
        { name: 'Optional: Nur-OBS-Modus aktivieren', text: 'Du willst beim Streamen einen freien Desktop? Aktiviere den „Nur-OBS-Modus“, um die Desktop-Katze auszublenden — das OBS-Overlay läuft samt Passwortschutz live weiter.' },
      ],
      extraTitle: 'Chroma-Key-Fensteraufnahme als Fallback (KuroCat Live)',
      extraBody: 'Für Streaming-Tools ohne transparente Browser-Quellen bietet KuroCat zusätzlich das rahmenlose Fenster „KuroCat Live“ mit umschaltbarem Blau-, Grün- oder Magenta-Hintergrund.',
      faqs: [
        { q: 'Sendet die OBS-Browser-Quelle meine Tasteneingaben ins Internet?', a: 'Niemals. Der Overlay-Server bindet ausschließlich an 127.0.0.1 (Localhost) und bleibt deaktiviert, bis du ihn bewusst einschaltest.' },
        { q: 'Funktioniert der Passwort-Sichtschutz auch im OBS-Stream?', a: 'Ja! Sobald unter Windows oder macOS ein Passwortfeld fokussiert wird, schließt auch das OBS-Overlay sofort die Augen der Katze und blendet alle Tasten und Bubbles aus.' },
        { q: 'Verbraucht der OBS-Dienst Ressourcen, wenn ich nicht streame?', a: 'Nein. Standardmäßig ist der Server komplett aus und belegt weder Threads noch Ports.' },
      ],
    },
  }[locale];

  const bodyHtml = `
    <section class="card">
      <h2>${esc(copy.stepsTitle)}</h2>
      <div class="code-box">
        <button class="copy-btn" type="button" data-copy="${esc(obsUrl)}">${esc(nav.copy)}</button>
        <pre>${esc(obsUrl)}</pre>
      </div>
      <div class="grid-3">
        ${copy.steps.map((s, i) => `<div class="mini-card"><h3><span class="step-num">${i + 1}</span>${esc(s.name)}</h3><p>${esc(s.text)}</p></div>`).join('\n        ')}
      </div>
    </section>

    <section class="card">
      <h2>${esc(copy.extraTitle)}</h2>
      <p>${esc(copy.extraBody)}</p>
    </section>
  `;

  return renderPage({
    locale,
    slug: 'obs',
    title: copy.title,
    description: copy.description,
    eyebrow: copy.eyebrow,
    h1: copy.h1,
    lead: copy.lead,
    breadcrumbLabel: copy.breadcrumb,
    bodyHtml,
    faqs: copy.faqs,
    howToSteps: copy.steps,
    today,
  });
}

function buildMcpPage(locale, today) {
  const nav = NAV_I18N[locale];
  const mcpHttpCfg = `{
  "mcpServers": {
    "kurocat": {
      "url": "http://127.0.0.1:27420/mcp"
    }
  }
}`;
  const sampleSculptJson = `{
  "id": "scottish-fold-odd-eye",
  "name": "异瞳折耳吐舌猫",
  "faceShape": "round",
  "headWidth": 1.10,
  "earShape": "folded",
  "eyeScale": 1.20,
  "pupilShape": "round",
  "eyeColorTop": "#2c7be5",
  "rightEyeColorTop": "#d9921c",
  "noseShape": "small",
  "mouthShape": "blep",
  "blushAlways": true
}`;

  const copy = {
    zh: {
      title: 'KuroCat MCP AI 捏猫 & AI 编程伴侣 — Claude Code / Cursor / Codex / 豆包实时联动',
      description: 'KuroCat 原生内置 Stdio 与 Streamable HTTP (127.0.0.1:27420) MCP 服务端：支持 Claude Code、Cursor、Codex、DeepSeek、豆包状态实时同步，发一张宠物照片让 AI 0.4 秒调出脸型、折耳/垂耳、异瞳与 22 项精细五官。',
      eyebrow: 'Built-in MCP Server · AI Coding Companion',
      h1: 'AI 编程伴侣 & MCP 全五官自由捏宠',
      lead: '无需安装 Node.js 或 Python，KuroCat 单文件原生内置 MCP 服务端与 Agent Hook：既能让 AI 写代码时自动陪你敲键盘、跑完叮咚提醒，也能发一张照片让 AI 0.4 秒把你家毛孩子捏进 2D/3D 桌面。',
      breadcrumb: 'AI 伴侣 & MCP',
      cfgTitle: '1 分钟接入 MCP（Claude Desktop / Cursor / Windsurf / Antigravity）',
      cfgDesc: '右键猫咪或系统托盘点「复制 MCP 配置」即可获取 Stdio 配置，或直接连接运行中的本机 Streamable HTTP 端点：',
      sculptTitle: '全新 2D / 3D 全维度五官捏脸（看图捏宠更像了）',
      sculptItems: [
        ['脸型与体型', '5 种脸型（round / square 藏狐方脸 / wide 虎熊宽腮 / fox / oval）+ headWidth + jawSquareness + bodyChubbiness'],
        ['7 种耳型（含折耳/垂耳）', 'cat / round / tall / small / wide / folded（折耳猫）/ floppy（垂耳狗/兔）+ earScale / earSpacing / earTilt'],
        ['眼睛全维度 + 异瞳', 'eyeScale / eyeAspect / eyeSpacing / eyeOffsetY / eyeTilt / eyeSquint + 5 种瞳孔（oval / round / slit 竖瞳 / dot 豆豆眼 / star 星星眼）+ rightEyeColorTop 异瞳'],
        ['鼻嘴、眉毛、胡须与斑点', '5 种鼻型 + 6 种嘴型（含 blep 呆萌吐舌）+ 5 种眉型（含柴犬豆豆眉）+ 可隐藏胡须 + 常驻腮红 + 最多 16 处 3D 自定义斑点'],
      ],
      jsonTitle: '示例：异瞳折耳吐舌猫 MCP JSON（0.4s 热重载）',
      promptsTitle: '直接复制给 AI 的捏猫提示词',
      prompts: [
        '看这张我家猫的照片，先调用 KuroCat MCP 的 get_cat_schema，再按它的脸型、耳型、眼色、五官比例和斑点位置帮我用 upsert_cat 捏一只 3D 桌宠并切过去！',
        '帮我用 KuroCat MCP 捏一只异瞳折耳白猫（左蓝右金、圆大眼、粉色小鼻子和吐舌 blep 表情，常驻腮红），并立刻切换显示。',
        '帮我用 KuroCat MCP 捏一只带白色豆豆眉、垂耳、隐藏胡须、大圆黑鼻子和开心微笑的柴犬桌宠！',
      ],
      faqs: [
        { q: '使用 KuroCat MCP 需要装 Node.js 或 Python 吗？', a: '完全不需要。KuroCat 用 Rust 在单个客户端程序内原生实现了 Stdio（--mcp）与本机 Streamable HTTP（http://127.0.0.1:27420/mcp）双模式 MCP 服务端。' },
        { q: '支持哪些 AI 编程工具的状态联动？', a: '支持 Claude Code、Codex CLI、Cursor、Windsurf、Antigravity、DeepSeek、豆包工作版等：AI 写代码时小猫自动代打，等你确认时轻提醒，报错炸毛，任务完成眯眼脸红并同步到 OBS 直播源。' },
        { q: '可以按照片修改脸型、五官大小和位置吗？', a: '可以！最新 MCP schema 已在 2D 和 3D 引擎同步开放脸型、7 种耳型（含折耳/垂耳）、眼睛大小/圆扁/眼距/高低/倾角、5 种瞳孔、异瞳、鼻嘴形状位置、眉毛与胡须等全部精细参数。' },
      ],
    },
    en: {
      title: 'KuroCat MCP Server & AI Coding Companion — Claude Code / Cursor / Codex Desktop Pet',
      description: 'Built-in zero-dependency Stdio & Streamable HTTP MCP server (127.0.0.1:27420/mcp) inside KuroCat: real-time Claude Code / Cursor / Codex companion hooks plus 22 facial sculpting parameters (folded/floppy ears, heterochromia, blep, eyebrows) in 2D & 3D.',
      eyebrow: 'Built-in MCP Server · AI Coding Companion',
      h1: 'AI Coding Companion & Built-In MCP Pet Studio',
      lead: 'Zero Node.js or Python needed. KuroCat embeds both Stdio and local Streamable HTTP MCP servers so Claude Code, Cursor, Codex, or Windsurf can animate your desktop pet while coding — and sculpt your own pet from a photo in 0.4 seconds.',
      breadcrumb: 'AI & MCP Studio',
      cfgTitle: 'Connect MCP in 1 Minute (Claude Desktop / Cursor / Windsurf)',
      cfgDesc: 'Right-click KuroCat → "Copy MCP Config" for Stdio, or point any MCP client directly at the running local Streamable HTTP endpoint:',
      sculptTitle: 'Full 2D + 3D Facial Sculpting via MCP',
      sculptItems: [
        ['Head & Body Silhouette', '5 faceShape presets (round / square / wide / fox / oval) + headWidth + jawSquareness + bodyChubbiness'],
        ['7 Ear Shapes (Folded & Floppy)', 'cat / round / tall / small / wide / folded (Scottish Fold) / floppy (puppy/lop) + earScale / earSpacing / earTilt'],
        ['Eyes, Pupils & Heterochromia', 'eyeScale / eyeAspect / eyeSpacing / eyeOffsetY / eyeTilt / eyeSquint + 5 pupil shapes (oval / round / slit / dot / star) + rightEyeColorTop odd-eyed heterochromia'],
        ['Nose, Mouth, Brows & Spots', '5 nose shapes + 6 mouth styles (incl. cute blep tongue) + 5 eyebrow styles (incl. Shiba dot brows) + whiskerLength (0 hides) + permanent blush + up to 16 3D spots'],
      ],
      jsonTitle: 'Example: Odd-Eyed Scottish Fold Blep JSON (0.4s Live Hot-Reload)',
      promptsTitle: 'Copy-Paste AI Prompts',
      prompts: [
        'Look at this photo of my pet. Call KuroCat MCP get_cat_schema first, then sculpt its face shape, ears, eyes, facial proportions, and spots using upsert_cat and switch to it!',
        'Use KuroCat MCP to create an odd-eyed white Scottish Fold cat (blue left eye, amber right eye, folded ears, cute blep tongue, permanent soft blush) and activate it.',
        'Use KuroCat MCP to sculpt a smiling Shiba Inu with thick cream dot eyebrows, no whiskers, round black nose, and fluffy tail!',
      ],
      faqs: [
        { q: 'Does KuroCat MCP require Node.js or Python?', a: 'No. Both Stdio (--mcp) and local Streamable HTTP (http://127.0.0.1:27420/mcp) are compiled natively in Rust inside the single KuroCat binary.' },
        { q: 'Which AI coding tools can drive KuroCat as a companion?', a: 'Claude Code, Codex CLI, Cursor, Windsurf, Antigravity, DeepSeek, and Doubao via --hook, local HTTP /hook, or Streamable HTTP /mcp.' },
      ],
    },
    ja: {
      title: 'KuroCat MCP サーバー＆AI コーディング相棒 — Claude Code / Cursor / Codex 連携＆AI 顔カスタム',
      description: 'Node.js・Python 不要のネイティブ MCP サーバー（127.0.0.1:27420/mcp）を内蔵。Claude Code や Cursor の作業状態をリアルタイム反映し、22 項目の顔パラメータ（折れ耳・垂れ耳・オッドアイ・舌出し）で写真から愛猫を 0.4 秒再現。',
      eyebrow: 'Built-in MCP Server · AI コーディングコンパニオン',
      h1: 'AI コーディング連携＆MCP フル顔カスタム',
      lead: '追加ランタイム不要。Claude Code / Cursor / Codex の作業中に黒猫が代わりにタイピングし、完了やエラーを表情でお知らせ。さらに愛猫の写真から 0.4 秒で 2D/3D 再現できます。',
      breadcrumb: 'AI & MCP',
      cfgTitle: '1 分で MCP 接続（Claude Desktop / Cursor / Windsurf）',
      cfgDesc: '右クリック「MCP 設定をコピー」または実行中のローカル Streamable HTTP エンドポイントへ直接接続できます：',
      sculptTitle: '2D / 3D 同期 22 項目フル顔造形パラメータ',
      sculptItems: [
        ['輪郭・体型', '5 種の faceShape（round / square / wide / fox / oval）＋ headWidth / jawSquareness / bodyChubbiness'],
        ['7 種の耳型（折れ耳・垂れ耳対応）', 'cat / round / tall / small / wide / folded（スコティッシュ）/ floppy（垂れ耳犬・うさぎ）＋ 間隔・傾き'],
        ['目・瞳・オッドアイ', '目の大きさ/縦横比/間隔/高さ/つり目・垂れ目 ＋ 5 種の瞳（oval / round / slit / dot / star）＋ 左右別色オッドアイ'],
        ['鼻・口・眉・ひげ・模様', '5 種の鼻 ＋ 6 種の口（舌出し blep 含む）＋ 柴犬まろ眉など 5 種の眉 ＋ ひげ長（0 で非表示）＋ 常時チーク ＋ 斑点 16 箇所'],
      ],
      jsonTitle: 'MCP JSON サンプル（オッドアイ折れ耳・舌出し白猫）',
      promptsTitle: 'AI にそのまま貼れるプロンプト',
      prompts: [
        'この愛猫の写真を見て、KuroCat MCP の get_cat_schema を確認してから、輪郭・耳・目・模様まで upsert_cat で再現して切り替えて！',
        'KuroCat MCP で左青・右金のオッドアイ、折れ耳、舌出し（blep）、常時チークの白猫を作って切り替えて！',
      ],
      faqs: [
        { q: 'MCP 利用に Node.js や Python の導入は必要ですか？', a: '不要です。単体バイナリに Rust ネイティブの Stdio とローカル Streamable HTTP（127.0.0.1:27420/mcp）を内蔵しています。' },
      ],
    },
    ko: {
      title: 'KuroCat MCP 서버 & AI 코딩 컴패니언 — Claude Code / Cursor / Codex 연동 및 AI 얼굴 커스텀',
      description: 'Node.js·Python 설치 없이 내장된 Rust MCP 서버(127.0.0.1:27420/mcp): Claude Code·Cursor 작업 상태 실시간 연동 및 22종 정밀 얼굴 커스텀(접힌 귀/처진 귀/오드아이/혀 내밀기) 지원.',
      eyebrow: 'Built-in MCP Server · AI 코딩 컴패니언',
      h1: 'AI 코딩 컴패니언 & 내장 MCP 펫 스튜디오',
      lead: '별도 런타임 없이 단일 앱에 Stdio와 로컬 Streamable HTTP MCP 서버를 내장했습니다. AI 코딩 중 자동 타이핑·알림 연동은 물론, 반려묘 사진 한 장으로 0.4초 만에 2D/3D 펫을 제작하세요.',
      breadcrumb: 'AI & MCP',
      cfgTitle: '1분 만에 MCP 연결 (Claude Desktop / Cursor / Windsurf)',
      cfgDesc: '우클릭「MCP 설정 복사」를 쓰거나 실행 중인 로컬 Streamable HTTP 주소로 바로 연결하세요:',
      sculptTitle: '2D / 3D 동시 지원 22종 정밀 얼굴 커스텀',
      sculptItems: [
        ['얼굴형 & 체형', '5가지 faceShape(round / square / wide / fox / oval) + headWidth + jawSquareness + bodyChubbiness'],
        ['7가지 귀 모양 (폴드/처진 귀)', 'cat / round / tall / small / wide / folded(스코티시 폴드) / floppy(강아지·토끼 처진 귀) + 간격·각도'],
        ['눈·동공 & 오드아이', '눈 크기/비율/간격/높이/눈꼬리 + 5가지 동공(oval / round / slit / dot / star) + 좌우 다른 색 오드아이'],
        ['코·입·눈썹·수염·얼룩', '5가지 코 + 6가지 입(혀 내밀기 blep 포함) + 시바견 콩눈썹 등 5가지 눈썹 + 수염 숨김(0) + 상시 볼터치 + 최대 16개 3D 얼룩'],
      ],
      jsonTitle: '예시: 오드아이 스코티시 폴드 혀 내밀기 JSON (0.4초 핫리로드)',
      promptsTitle: 'AI에게 바로 복사해서 쓰는 프롬프트',
      prompts: [
        '우리 집 반려동물 사진을 보고 KuroCat MCP get_cat_schema를 먼저 확인한 뒤, 얼굴형·귀·눈 비율·무늬까지 upsert_cat으로 만들어 적용해 줘!',
        'KuroCat MCP로 왼쪽 파란 눈·오른쪽 금색 눈 오드아이, 접힌 귀(folded), 혀 내밀기(blep), 상시 볼터치 흰 고양이를 만들어 바로 전환해 줘!',
      ],
      faqs: [
        { q: 'KuroCat MCP를 쓰려면 Node.js나 Python이 필요한가요?', a: '아니요. Rust로 작성된 Stdio(--mcp)와 로컬 Streamable HTTP(127.0.0.1:27420/mcp)가 단일 앱 안에 기본 내장되어 있습니다.' },
      ],
    },
    es: {
      title: 'Servidor MCP de KuroCat y compañero IA de programación — Mascota de escritorio para Claude Code / Cursor / Codex',
      description: 'Servidor MCP integrado sin dependencias (Stdio y Streamable HTTP en 127.0.0.1:27420/mcp) dentro de KuroCat: hooks en tiempo real para Claude Code, Cursor y Codex más 22 parámetros faciales (orejas dobladas/caídas, heterocromía, blep, cejas) en 2D y 3D.',
      eyebrow: 'Servidor MCP integrado · Compañero IA de código',
      h1: 'Compañero IA de programación y estudio de mascotas MCP',
      lead: 'Sin necesidad de instalar Node.js ni Python. KuroCat integra servidores MCP Stdio y Streamable HTTP locales para que Claude Code, Cursor, Codex o Windsurf animen a tu mascota mientras programas — y esculpan tu propia mascota desde una foto en 0.4 segundos.',
      breadcrumb: 'IA y MCP Studio',
      cfgTitle: 'Conecta MCP en 1 minuto (Claude Desktop / Cursor / Windsurf)',
      cfgDesc: 'Haz clic derecho en KuroCat → «Copiar configuración MCP» para Stdio, o conecta cualquier cliente MCP directamente al endpoint Streamable HTTP local en ejecución:',
      sculptTitle: 'Esculpido facial completo 2D + 3D mediante MCP',
      sculptItems: [
        ['Silueta de cabeza y cuerpo', '5 presets de faceShape (round / square / wide / fox / oval) + headWidth + jawSquareness + bodyChubbiness'],
        ['7 formas de orejas (dobladas y caídas)', 'cat / round / tall / small / wide / folded (Scottish Fold) / floppy (perrito/conejo) + earScale / earSpacing / earTilt'],
        ['Ojos, pupilas y heterocromía', 'eyeScale / eyeAspect / eyeSpacing / eyeOffsetY / eyeTilt / eyeSquint + 5 pupilas (oval / round / slit / dot / star) + rightEyeColorTop para heterocromía'],
        ['Nariz, boca, cejas y manchas', '5 formas de nariz + 6 estilos de boca (incluida lengüita blep) + 5 estilos de cejas (incluidas cejas punto Shiba) + whiskerLength (0 oculta) + rubor permanente + hasta 16 manchas 3D'],
      ],
      jsonTitle: 'Ejemplo: JSON de Scottish Fold con heterocromía y blep (recarga en vivo 0.4 s)',
      promptsTitle: 'Prompts listos para copiar y pegar en tu IA',
      prompts: [
        'Mira esta foto de mi mascota. Primero llama a get_cat_schema del MCP de KuroCat y luego esculpe su forma de cara, orejas, ojos, proporciones faciales y manchas con upsert_cat y actívala.',
        'Usa KuroCat MCP para crear un gato Scottish Fold blanco con heterocromía (ojo izquierdo azul, derecho ámbar, orejas dobladas, lengüita blep y rubor suave permanente) y actívalo ahora.',
        'Usa KuroCat MCP para esculpir un Shiba Inu sonriente con cejas crema gruesas de punto, sin bigotes, nariz negra redonda y cola esponjosa.',
      ],
      faqs: [
        { q: '¿KuroCat MCP requiere instalar Node.js o Python?', a: 'No. Tanto Stdio (--mcp) como Streamable HTTP local (http://127.0.0.1:27420/mcp) están compilados de forma nativa en Rust dentro del único ejecutable de KuroCat.' },
        { q: '¿Qué herramientas IA de programación pueden controlar a KuroCat?', a: 'Claude Code, Codex CLI, Cursor, Windsurf, Antigravity, DeepSeek y Doubao mediante --hook, HTTP local /hook o Streamable HTTP /mcp.' },
        { q: '¿Puedo ajustar la forma de la cara y rasgos exactos a partir de una foto?', a: 'Sí. El esquema MCP sincroniza los 22 parámetros faciales en los motores 2D y 3D (rostro, 7 orejas, tamaño/ángulo ocular, 5 pupilas, heterocromía, nariz, boca, cejas, bigotes y manchas).' },
      ],
    },
    pt: {
      title: 'Servidor MCP do KuroCat e companheiro de IA para código — Claude Code / Cursor / Codex',
      description: 'Servidor MCP nativo sem dependências (Stdio e Streamable HTTP em 127.0.0.1:27420/mcp) dentro do KuroCat: hooks em tempo real para Claude Code, Cursor e Codex além de 22 parâmetros faciais (orelhas dobradas/caídas, heterocromia, blep, sobrancelhas) em 2D e 3D.',
      eyebrow: 'Servidor MCP nativo · Companheiro IA de programação',
      h1: 'Companheiro de código com IA e estúdio de pets MCP',
      lead: 'Zero Node.js ou Python necessários. O KuroCat traz servidores MCP Stdio e Streamable HTTP locais embutidos para que Claude Code, Cursor, Codex ou Windsurf animem seu pet enquanto você programa — e modelem seu próprio pet a partir de uma foto em 0,4 segundo.',
      breadcrumb: 'IA & MCP Studio',
      cfgTitle: 'Conecte o MCP em 1 minuto (Claude Desktop / Cursor / Windsurf)',
      cfgDesc: 'Clique com o botão direito no KuroCat → «Copiar config MCP» para Stdio, ou aponte qualquer cliente MCP diretamente para o endpoint Streamable HTTP local:',
      sculptTitle: 'Modelagem facial completa em 2D + 3D via MCP',
      sculptItems: [
        ['Silhueta da cabeça e corpo', '5 presets de faceShape (round / square / wide / fox / oval) + headWidth + jawSquareness + bodyChubbiness'],
        ['7 formatos de orelhas (dobradas e caídas)', 'cat / round / tall / small / wide / folded (Scottish Fold) / floppy (cachorrinho/coelho) + earScale / earSpacing / earTilt'],
        ['Olhos, pupilas e heterocromia', 'eyeScale / eyeAspect / eyeSpacing / eyeOffsetY / eyeTilt / eyeSquint + 5 pupilas (oval / round / slit / dot / star) + rightEyeColorTop para olhos de cores diferentes'],
        ['Nariz, boca, sobrancelhas e manchas', '5 formatos de nariz + 6 bocas (incluindo linguinha blep) + 5 sobrancelhas (incluindo bolinhas Shiba) + whiskerLength (0 oculta) + blush fixo + até 16 manchas 3D'],
      ],
      jsonTitle: 'Exemplo: JSON de Scottish Fold com heterocromia e blep (hot-reload em 0,4 s)',
      promptsTitle: 'Prompts prontos para copiar e colar na IA',
      prompts: [
        'Olhe esta foto do meu pet. Chame primeiro get_cat_schema no MCP do KuroCat e depois modele o formato do rosto, orelhas, olhos, proporções e manchas usando upsert_cat e ative na hora!',
        'Use o KuroCat MCP para criar um gato Scottish Fold branco com heterocromia (olho esquerdo azul, direito âmbar, orelhas dobradas, linguinha blep e blush suave fixo) e ative-o.',
        'Use o KuroCat MCP para modelar um Shiba Inu sorridente com sobrancelhas creme em bolinha, sem bigodes, nariz preto redondo e cauda fofinha!',
      ],
      faqs: [
        { q: 'O KuroCat MCP precisa de Node.js ou Python?', a: 'Não. Tanto Stdio (--mcp) quanto Streamable HTTP local (http://127.0.0.1:27420/mcp) são compilados nativamente em Rust dentro do executável único do KuroCat.' },
        { q: 'Quais ferramentas de IA para código podem controlar o KuroCat?', a: 'Claude Code, Codex CLI, Cursor, Windsurf, Antigravity, DeepSeek e Doubao via --hook, HTTP local /hook ou Streamable HTTP /mcp.' },
        { q: 'Posso ajustar o rosto e traços exatos do meu gato por foto?', a: 'Sim! O schema MCP aplica todos os 22 parâmetros simultaneamente em 2D e 3D (rosto, 7 orelhas, proporção dos olhos, 5 pupilas, heterocromia, nariz, boca, sobrancelhas, bigodes e manchas).' },
      ],
    },
    ru: {
      title: 'MCP-сервер KuroCat и ИИ-компаньон для кода — Claude Code / Cursor / Codex',
      description: 'Встроенный MCP-сервер без зависимостей (Stdio и Streamable HTTP на 127.0.0.1:27420/mcp) внутри KuroCat: хуки в реальном времени для Claude Code, Cursor и Codex плюс 22 параметра внешности (вислоухие уши, гетерохромия, язычок blep, брови) в 2D и 3D.',
      eyebrow: 'Встроенный MCP-сервер · ИИ-компаньон для разработки',
      h1: 'ИИ-компаньон для кодинга и встроенная MCP-студия питомцев',
      lead: 'Никакого Node.js или Python. KuroCat объединяет нативные серверы Stdio и локальный Streamable HTTP MCP, чтобы Claude Code, Cursor, Codex или Windsurf оживляли питомца во время кодинга — и создавали вашего питомца по фото за 0,4 секунды.',
      breadcrumb: 'ИИ и MCP',
      cfgTitle: 'Подключение MCP за 1 минуту (Claude Desktop / Cursor / Windsurf)',
      cfgDesc: 'Нажмите ПКМ по KuroCat → «Копировать конфиг MCP» для Stdio или подключите любой MCP-клиент напрямую к локальному Streamable HTTP эндпоинту:',
      sculptTitle: 'Полная 2D + 3D настройка мордочки через MCP',
      sculptItems: [
        ['Силуэт головы и тела', '5 пресетов faceShape (round / square / wide / fox / oval) + headWidth + jawSquareness + bodyChubbiness'],
        ['7 форм ушей (включая вислоухих)', 'cat / round / tall / small / wide / folded (шотландский вислоухий) / floppy (висячие уши щенка/кролика) + earScale / earSpacing / earTilt'],
        ['Глаза, зрачки и гетерохромия', 'eyeScale / eyeAspect / eyeSpacing / eyeOffsetY / eyeTilt / eyeSquint + 5 форм зрачков (oval / round / slit / dot / star) + rightEyeColorTop для разноцветных глаз'],
        ['Нос, рот, брови и пятна', '5 форм носа + 6 видов рта (включая милый язычок blep) + 5 стилей бровей (включая брови-точки сиба-ину) + whiskerLength (0 скрывает усы) + постоянный румянец + до 16 3D-пятен'],
      ],
      jsonTitle: 'Пример: JSON вислоухого кота с гетерохромией и язычком blep (обновление за 0,4 с)',
      promptsTitle: 'Готовые промпты для копирования в ИИ',
      prompts: [
        'Посмотри на это фото моего питомца. Сначала вызови get_cat_schema в KuroCat MCP, а затем воссоздай форму головы, уши, глаза, пропорции и пятна через upsert_cat и сразу переключись на него!',
        'Используй KuroCat MCP, чтобы создать белого шотландского вислоухого кота с гетерохромией (левый глаз голубой, правый янтарный, сложенные уши, язычок blep и постоянный мягкий румянец), и активируй его.',
        'С помощью KuroCat MCP сделай улыбающегося сиба-ину с кремовыми бровями-точками, без усов, с круглым чёрным носом и пушистым хвостом!',
      ],
      faqs: [
        { q: 'Нужны ли Node.js или Python для работы KuroCat MCP?', a: 'Нет. И Stdio (--mcp), и локальный Streamable HTTP (http://127.0.0.1:27420/mcp) скомпилированы нативно на Rust внутри одного бинарного файла KuroCat.' },
        { q: 'Какие ИИ-инструменты для программирования поддерживаются?', a: 'Claude Code, Codex CLI, Cursor, Windsurf, Antigravity, DeepSeek и Doubao через --hook, локальный HTTP /hook или Streamable HTTP /mcp.' },
        { q: 'Можно ли точно повторить форму мордочки и черты питомца с фото?', a: 'Да. Схема MCP синхронно применяет все 22 параметра в 2D и 3D: форму головы, 7 типов ушей, посадку и наклон глаз, 5 зрачков, гетерохромию, нос, рот, брови, усы и пятна.' },
      ],
    },
    de: {
      title: 'KuroCat MCP-Server & KI-Coding-Begleiter — Desktop-Haustier für Claude Code / Cursor / Codex',
      description: 'Integrierter, abhängigkeitsfreier Stdio- & Streamable-HTTP-MCP-Server (127.0.0.1:27420/mcp) in KuroCat: Live-Hooks für Claude Code, Cursor & Codex sowie 22 Gesichtsparameter (Faltohren/Schlappohren, Heterochromie, Blep, Brauen) in 2D & 3D.',
      eyebrow: 'Integrierter MCP-Server · KI-Coding-Begleiter',
      h1: 'KI-Coding-Begleiter & integriertes MCP-Haustierstudio',
      lead: 'Kein Node.js oder Python nötig. KuroCat bringt Stdio- und lokale Streamable-HTTP-MCP-Server direkt mit, damit Claude Code, Cursor, Codex oder Windsurf dein Desktop-Haustier beim Coden animieren — und dein eigenes Haustier anhand eines Fotos in 0,4 Sekunden modellieren.',
      breadcrumb: 'KI & MCP-Studio',
      cfgTitle: 'MCP in 1 Minute verbinden (Claude Desktop / Cursor / Windsurf)',
      cfgDesc: 'Klicke mit rechts auf KuroCat → „MCP-Konfiguration kopieren“ für Stdio oder verbinde jeden MCP-Client direkt mit dem laufenden lokalen Streamable-HTTP-Endpunkt:',
      sculptTitle: 'Vollständiges 2D- + 3D-Gesichtssculpting über MCP',
      sculptItems: [
        ['Kopf- & Körpersilhouette', '5 faceShape-Presets (round / square / wide / fox / oval) + headWidth + jawSquareness + bodyChubbiness'],
        ['7 Ohrformen (Falt- & Schlappohren)', 'cat / round / tall / small / wide / folded (Scottish Fold) / floppy (Hund/Kaninchen) + earScale / earSpacing / earTilt'],
        ['Augen, Pupillen & Heterochromie', 'eyeScale / eyeAspect / eyeSpacing / eyeOffsetY / eyeTilt / eyeSquint + 5 Pupillenformen (oval / round / slit / dot / star) + rightEyeColorTop für zweifarbige Augen'],
        ['Nase, Mund, Brauen & Flecken', '5 Nasenformen + 6 Mundstile (inkl. süßer Blep-Zunge) + 5 Brauenstile (inkl. Shiba-Punktbrauen) + whiskerLength (0 blendet aus) + dauerhaftes Erröten + bis zu 16 3D-Flecken'],
      ],
      jsonTitle: 'Beispiel: Scottish Fold mit Heterochromie & Blep-JSON (0,4 s Live-Hot-Reload)',
      promptsTitle: 'KI-Prompts zum direkten Kopieren',
      prompts: [
        'Sieh dir dieses Foto meines Haustiers an. Rufe zuerst get_cat_schema im KuroCat-MCP auf, modelliere dann Gesichtsform, Ohren, Augen, Proportionen und Flecken per upsert_cat und aktiviere es direkt!',
        'Nutze KuroCat MCP, um eine weiße Scottish-Fold-Katze mit Heterochromie (linkes Auge blau, rechtes bernsteinfarben, Faltohren, Blep-Zunge und sanftem Dauer-Erröten) zu erstellen und sofort zu aktivieren.',
        'Modelliere über KuroCat MCP einen lächelnden Shiba Inu mit cremefarbenen Punktbrauen, ohne Schnurrhaare, mit runder schwarzer Nase und flauschigem Schweif!',
      ],
      faqs: [
        { q: 'Benötigt KuroCat MCP Node.js oder Python?', a: 'Nein. Sowohl Stdio (--mcp) als auch lokales Streamable HTTP (http://127.0.0.1:27420/mcp) sind nativ in Rust direkt in die einzelne KuroCat-Datei einkompiliert.' },
        { q: 'Welche KI-Coding-Tools können KuroCat als Begleiter steuern?', a: 'Claude Code, Codex CLI, Cursor, Windsurf, Antigravity, DeepSeek und Doubao per --hook, lokalem HTTP /hook oder Streamable HTTP /mcp.' },
        { q: 'Kann ich Gesichtsform und Details genau nach einem Foto anpassen?', a: 'Ja. Das MCP-Schema synchronisiert alle 22 Gesichtsparameter gleichzeitig für 2D und 3D (Kopf, 7 Ohrformen, Augengröße/-neigung, 5 Pupillen, Heterochromie, Nase, Mund, Brauen, Schnurrhaare und Flecken).' },
      ],
    },
  }[locale];

  const howToSteps = [
    { name: copy.cfgTitle, text: 'Connect http://127.0.0.1:27420/mcp or KuroCat --mcp in Claude Desktop, Cursor, or Windsurf.' },
    { name: 'Inspect get_cat_schema', text: 'Let your AI assistant read all facial sculpting parameters and examples.' },
    { name: 'Call upsert_cat / patch_cat', text: 'Hot-reload your custom 2D & 3D desktop pet live in 0.4 seconds.' },
  ];

  const bodyHtml = `
    <section class="card">
      <h2>${esc(copy.cfgTitle)}</h2>
      <p>${esc(copy.cfgDesc)}</p>
      <div class="code-box">
        <button class="copy-btn" type="button" data-copy="${esc(mcpHttpCfg)}">${esc(nav.copy)}</button>
        <pre>${esc(mcpHttpCfg)}</pre>
      </div>
    </section>

    <section class="card">
      <h2>${esc(copy.sculptTitle)}</h2>
      <div class="grid-2">
        ${copy.sculptItems.map((it) => `<div class="mini-card"><h3>${esc(it[0])}</h3><p>${esc(it[1])}</p></div>`).join('\n        ')}
      </div>
    </section>

    <section class="card">
      <h2>${esc(copy.jsonTitle)}</h2>
      <div class="code-box">
        <button class="copy-btn" type="button" data-copy="${esc(sampleSculptJson)}">${esc(nav.copy)}</button>
        <pre>${esc(sampleSculptJson)}</pre>
      </div>
      <h3>${esc(copy.promptsTitle)}</h3>
      ${copy.prompts
        .map(
          (pr) =>
            `<div class="code-box"><button class="copy-btn" type="button" data-copy="${esc(pr)}">${esc(nav.copy)}</button><pre style="white-space:pre-wrap">${esc(pr)}</pre></div>`,
        )
        .join('\n      ')}
    </section>
  `;

  return renderPage({
    locale,
    slug: 'mcp',
    title: copy.title,
    description: copy.description,
    eyebrow: copy.eyebrow,
    h1: copy.h1,
    lead: copy.lead,
    breadcrumbLabel: copy.breadcrumb,
    bodyHtml,
    faqs: copy.faqs,
    howToSteps,
    today,
  });
}

function buildSecurityPage(locale, today) {
  const copy = {
    zh: {
      title: 'KuroCat 官方防伪安全公告 — 警惕假冒网站 kurocat.net 分发 64 MB 疑似木马假包',
      description: 'KuroCat 唯一官方网站为 kurocat.org（开源仓库 github.com/qianyiai/KuroCat）。本文公布假冒网站 kurocat.net 分发 64.25 MB 非官方填充包 KuroCat.v5.1.0.zip 的取证证据、SHA-256 对比与中招处置步骤。',
      eyebrow: 'Security Advisory · 官方防伪认证与高危假站通告',
      h1: 'KuroCat 官方防伪公告：谨防假冒站 kurocat.net 木马风险',
      lead: 'KuroCat 由谦一（@qianyiai）唯一开源维护。近期出现高仿域名 kurocat.net 冒充「KuroCat 官网」并向 Windows 用户分发非官方 64.25 MB 篡改压缩包。请认准唯一官网 kurocat.org 与官方 GitHub。',
      breadcrumb: '防伪安全公告',
      officialTitle: '✅ 唯一受信任的官方渠道（仅此 3 处）',
      officialList: [
        '唯一官方网站与高速下载中心：https://kurocat.org/ 与 https://kurocat.org/download/',
        '唯一官方开源仓库与 Releases：https://github.com/qianyiai/KuroCat',
        '唯一官方 macOS Homebrew 源：https://github.com/qianyiai/homebrew-tap（brew install --cask qianyiai/tap/kurocat）',
      ],
      iocTitle: '🚨 假冒网站 kurocat.net 实锤取证对比',
      iocIntro: 'kurocat.net（注册于 2026-11-24，与作者完全无关）在 downloads.html 中将 macOS/Linux/Android 指向真正的 GitHub 作为伪装，却唯独将 Windows 10/11 主下载按钮替换为自己托管的异常压缩包：',
      cols: ['比对项', '正版官方（kurocat.org / GitHub）', '高危假冒站（kurocat.net）'],
      rows: [
        ['官方状态', '✅ 唯一官方网站与原作者仓库', '❌ 仿冒站点，与作者完全无关'],
        ['Windows 10/11 主文件', 'KuroCat-5.1.3-x64-setup.exe（v5.1.0 为 2.16 MB .exe）', 'KuroCat.v5.1.0.zip（官方从未发布过此 ZIP！）'],
        ['安装包体积', '2.40 MB（原生 Rust + Tauri v2）', '64.25 MB（67,371,456 字节，异常膨胀近 30 倍）'],
        ['内部可执行文件', '单一原生 Rust 二进制（约 5–6 MB）', '非官方 35.92 MB KuroCat.exe（CRC32: 0e67ba17）'],
        ['异常填充文件（反查杀特征）', '无任何 .pak / .dat 填充文件', 'bin/resources.pak（精确 48.00 MiB 未压缩）+ bin/versions.dat（精确 2.00 MiB 未压缩），典型绕过杀软/沙箱体积限制的木马手法'],
        ['可疑包 SHA-256（切勿运行）', '详见 /download/ 逐一公开校验表', '19ad10c48a7448584f1d00aa086f52b38231bacd659f04e83d3cefc60209796d'],
      ],
      remedyTitle: '🛡️ 如果你不慎从 kurocat.net 下载或运行了该文件怎么办？',
      remedySteps: [
        '立即断开该 Windows 电脑的网络连接，防止潜在窃密木马回传凭证或持久化驻留。',
        '彻底删除下载的 KuroCat.v5.1.0.zip 及解压后的全部文件夹。',
        '使用 Windows Defender 脱机扫描（Microsoft Defender Offline）并配合主流杀毒工具进行全盘查杀。',
        '在另一台干净设备上修改该电脑浏览器曾登录过的重要密码，退出所有活跃会话，并吊销可能保存在本机的 API Token、SSH 密钥及加密钱包凭据。',
        '仅从唯一官网 https://kurocat.org/download/ 或 https://github.com/qianyiai/KuroCat/releases 重新下载正版，并使用 Get-FileHash 核对 SHA-256。',
      ],
      faqs: [
        { q: 'kurocat.net 是 KuroCat 的官网或安全镜像吗？', a: '不是！kurocat.net 与作者谦一（@qianyiai）没有任何关系，且正在分发含 50 MiB 异常填充与非官方 35.92 MB exe 的 64.25 MB 可疑压缩包。KuroCat 唯一官网为 https://kurocat.org/。' },
        { q: '为什么正版 Windows 安装包只有 2.4 MB，而假包高达 64 MB？', a: '正版 KuroCat 采用 Rust + Tauri v2 复用系统 WebView2，因此安装包仅 2.40 MB。假冒包强行塞入精确 48 MiB 的 resources.pak 与 2 MiB 的 versions.dat（未压缩 STORED），这是恶意软件绕过部分安全扫描器文件大小上限的典型手法。' },
        { q: '如何用一条命令确认我下载的是正版 KuroCat？', a: '在 PowerShell 运行 Get-FileHash KuroCat-5.1.3-x64-setup.exe -Algorithm SHA256，确认输出与 https://kurocat.org/download/ 及 GitHub Releases 公布的 64 位哈希完全一致即可。' },
      ],
    },
    en: {
      title: 'KuroCat Official Security Advisory — Warning Against Fake Site kurocat.net (64 MB Suspected Malware ZIP)',
      description: 'https://kurocat.org/ (github.com/qianyiai/KuroCat) is the ONLY official KuroCat website. Read forensic proof and IoCs showing impersonator kurocat.net distributes an unauthorized 64.25 MB padded ZIP (KuroCat.v5.1.0.zip).',
      eyebrow: 'Security Advisory · Official Verification & Impersonation Alert',
      h1: 'Official Security Advisory: Avoid Fake Site kurocat.net',
      lead: 'KuroCat is maintained exclusively by Qianyi (@qianyiai). An unaffiliated impersonator domain (kurocat.net) is spoofing KuroCat and serving an unauthorized 64.25 MB padded archive to Windows users. Only trust kurocat.org and github.com/qianyiai/KuroCat.',
      breadcrumb: 'Security Advisory',
      officialTitle: '✅ ONLY Official & Trusted Distribution Channels',
      officialList: [
        'Official Website & Verified CDN: https://kurocat.org/ and https://kurocat.org/en/download/',
        'Official GitHub Repository & Releases: https://github.com/qianyiai/KuroCat',
        'Official macOS Homebrew Tap: https://github.com/qianyiai/homebrew-tap (brew install --cask qianyiai/tap/kurocat)',
      ],
      iocTitle: '🚨 Forensic Comparison: Official KuroCat vs Impersonator kurocat.net',
      iocIntro: 'Registered on 2026-11-24, kurocat.net links secondary OS builds to our real GitHub as a decoy, while replacing the primary Windows 10/11 download with a self-hosted suspicious archive:',
      cols: ['Attribute', 'Official KuroCat (kurocat.org / GitHub)', 'Impersonator (kurocat.net)'],
      rows: [
        ['Official Affiliation', '✅ Exclusive official website & repo', '❌ Unaffiliated impersonation site'],
        ['Windows 10/11 Package', 'KuroCat-5.1.3-x64-setup.exe (v5.1.0 was 2.16 MB .exe)', 'KuroCat.v5.1.0.zip (never published by KuroCat!)'],
        ['Download Size', '2.40 MB (native Rust + Tauri v2)', '64.25 MB (67,371,456 bytes — ~30x bloated)'],
        ['Executable Binary', 'Native Rust binary (~5–6 MB unpacked)', 'Unauthorized 35.92 MB KuroCat.exe (CRC32: 0e67ba17)'],
        ['Evasion Padding', 'Zero .pak / .dat junk files', 'bin/resources.pak (exact 48.00 MiB STORED) + bin/versions.dat (exact 2.00 MiB STORED) — textbook AV/sandbox size-limit evasion'],
        ['Suspicious ZIP SHA-256', 'All official hashes published at /en/download/', '19ad10c48a7448584f1d00aa086f52b38231bacd659f04e83d3cefc60209796d'],
      ],
      remedyTitle: '🛡️ What to Do If You Downloaded or Ran Files from kurocat.net',
      remedySteps: [
        'Disconnect the affected Windows machine from the network immediately.',
        'Delete KuroCat.v5.1.0.zip and any extracted folder.',
        'Run Microsoft Defender Offline full scan plus a reputable second-opinion anti-malware scan.',
        'From a separate clean device, change passwords, invalidate browser sessions, and revoke any API tokens, SSH keys, or crypto wallets stored on the affected PC.',
        'Download KuroCat ONLY from https://kurocat.org/en/download/ or https://github.com/qianyiai/KuroCat/releases and verify SHA-256.',
      ],
      faqs: [
        { q: 'Is kurocat.net official or safe to download from?', a: 'No. kurocat.net is completely unaffiliated with KuroCat and distributes an unauthorized 64.25 MB ZIP padded with 50 MiB of uncompressed junk and an unknown 35.92 MB executable. Use only https://kurocat.org/ or https://github.com/qianyiai/KuroCat.' },
        { q: 'Why does the fake ZIP include a 48 MiB resources.pak and 2 MiB versions.dat?', a: 'Official KuroCat has no such files and weighs only ~2.4 MB. Padding an archive past 64 MB with uncompressed data is a well-known malware/infostealer technique to evade cloud AV upload and sandbox size thresholds.' },
      ],
    },
    ja: {
      title: 'KuroCat 公式セキュリティ警告 — 偽サイト kurocat.net の 64 MB 危険偽ビルドに注意',
      description: 'KuroCat 唯一の公式サイトは kurocat.org（github.com/qianyiai/KuroCat）です。偽サイト kurocat.net が配布している 64.25 MB の非公式 KuroCat.v5.1.0.zip（50 MiB パディング＋不明な 35.92 MB exe）の検証証拠と対処手順を公開します。',
      eyebrow: 'Security Advisory · 公式サイト認証＆偽サイト警告',
      h1: '公式セキュリティ警告：偽サイト kurocat.net にご注意',
      lead: 'KuroCat の唯一の公式サイトは kurocat.org です。作者と無関係ななりすましサイト kurocat.net が、Windows 向けに異常パディング入りの 64.25 MB 偽 ZIP を配布しています。絶対にダウンロード・実行しないでください。',
      breadcrumb: '偽サイト警告',
      officialTitle: '✅ 唯一の公式・安全な配布チャネル',
      officialList: [
        '公式ウェブサイト＆ダウンロード：https://kurocat.org/ja/ および https://kurocat.org/ja/download/',
        '公式 GitHub リポジトリ：https://github.com/qianyiai/KuroCat',
        '公式 macOS Homebrew Tap：https://github.com/qianyiai/homebrew-tap',
      ],
      iocTitle: '🚨 正規ビルドと偽サイト kurocat.net の比較証拠',
      iocIntro: 'kurocat.net は Mac/Linux 等を本物の GitHub へリンクして信用させつつ、Windows 10/11 の主ダウンロードだけを自前の 64.25 MB 偽ファイルに差し替えています：',
      cols: ['項目', '公式 KuroCat（kurocat.org / GitHub）', '偽サイト（kurocat.net）'],
      rows: [
        ['公式関係', '✅ 唯一の公式サイト・作者リポジトリ', '❌ 作者と完全に無関係な偽サイト'],
        ['Windows 10/11 ファイル', 'KuroCat-5.1.3-x64-setup.exe（約 2.40 MB）', 'KuroCat.v5.1.0.zip（公式には存在しない）'],
        ['容量と中身', '2.40 MB の正規 Rust インストーラー', '64.25 MB（不明な 35.92 MB exe ＋ 正確に 48 MiB の resources.pak ＋ 2 MiB の versions.dat）'],
        ['危険 ZIP の SHA-256', '/ja/download/ に全公式ハッシュ掲載', '19ad10c48a7448584f1d00aa086f52b38231bacd659f04e83d3cefc60209796d'],
      ],
      remedyTitle: '🛡️ すでに kurocat.net から実行してしまった場合の対処',
      remedySteps: [
        '直ちに該当 PC のネットワーク接続を切断してください。',
        'ダウンロードした ZIP および展開フォルダを削除してください。',
        'Microsoft Defender オフラインスキャン等でフルスキャンを実行してください。',
        '別の安全な端末から主要アカウントのパスワード変更・セッション無効化・API トークン/SSH 鍵の失効を行ってください。',
        '今後は必ず https://kurocat.org/ja/download/ または GitHub 公式から SHA-256 を確認して導入してください。',
      ],
      faqs: [
        { q: 'kurocat.net は安全ですか？', a: 'いいえ。マルウェア検知回避のための 50 MiB パディングと非公式 35.92 MB exe を含む危険な偽パッケージを配布しています。必ず https://kurocat.org/ja/ をご利用ください。' },
      ],
    },
    ko: {
      title: 'KuroCat 공식 보안 공지 — 사칭 사이트 kurocat.net 64 MB 변조 ZIP 악성코드 주의',
      description: 'KuroCat의 유일한 공식 사이트는 kurocat.org(github.com/qianyiai/KuroCat)입니다. 사칭 사이트 kurocat.net이 유포하는 64.25 MB 비공식 KuroCat.v5.1.0.zip의 분석 증거와 대처 방법을 안내합니다.',
      eyebrow: 'Security Advisory · 공식 인증 및 사칭 주의',
      h1: '공식 보안 공지: 사칭 사이트 kurocat.net 악성코드 위험 주의',
      lead: 'KuroCat의 유일한 공식 웹사이트는 kurocat.org 입니다. 제작자와 무관한 kurocat.net이 Windows 사용자에게 50 MiB 비정상 패딩이 들어간 64.25 MB 가짜 ZIP을 유포하고 있으니 절대 실행하지 마세요.',
      breadcrumb: '보안 공지',
      officialTitle: '✅ 유일한 공식 신뢰 채널',
      officialList: [
        '공식 웹사이트 및 다운로드: https://kurocat.org/ko/ · https://kurocat.org/ko/download/',
        '공식 GitHub 저장소: https://github.com/qianyiai/KuroCat',
        '공식 macOS Homebrew Tap: https://github.com/qianyiai/homebrew-tap',
      ],
      iocTitle: '🚨 정식 빌드 vs 사칭 사이트 kurocat.net 비교 증거',
      iocIntro: 'kurocat.net은 다른 OS 링크만 실제 GitHub로 연결해 안심시킨 뒤, Windows 10/11 메인 다운로드만 자체 호스팅된 변조 파일로 바꿔치기했습니다:',
      cols: ['항목', '공식 KuroCat (kurocat.org / GitHub)', '사칭 사이트 (kurocat.net)'],
      rows: [
        ['공식 여부', '✅ 유일한 공식 사이트 및 원작자 저장소', '❌ 제작자와 무관한 사칭 사이트'],
        ['Windows 10/11 파일', 'KuroCat-5.1.3-x64-setup.exe (2.40 MB)', 'KuroCat.v5.1.0.zip (공식 배포 이력 없음)'],
        ['용량 및 내부 구조', '네이티브 Rust 설치 파일 (2.40 MB)', '64.25 MB (출처 불명 35.92 MB exe + 정확히 48 MiB resources.pak + 2 MiB versions.dat)'],
        ['의심 ZIP SHA-256', '/ko/download/에서 공식 해시 전체 공개', '19ad10c48a7448584f1d00aa086f52b38231bacd659f04e83d3cefc60209796d'],
      ],
      remedyTitle: '🛡️ 이미 kurocat.net 파일을 실행했다면?',
      remedySteps: [
        '즉시 해당 Windows PC의 인터넷 연결을 차단하세요.',
        '다운로드한 ZIP 파일과 압축 해제 폴더를 모두 삭제하세요.',
        'Microsoft Defender 오프라인 전체 검사를 실행하세요.',
        '다른 안전한 기기에서 브라우저에 저장된 계정 비밀번호, 세션, API 토큰 및 SSH 키를 즉시 교체하세요.',
        '반드시 https://kurocat.org/ko/download/ 또는 공식 GitHub에서만 SHA-256 검증 후 설치하세요.',
      ],
      faqs: [
        { q: 'kurocat.net에서 받아도 되나요?', a: '절대 안 됩니다. 백신 탐지를 회피하려는 50 MiB 패딩과 비공식 35.92 MB exe가 담긴 위험한 가짜 파일입니다. 유일한 공식 사이트는 https://kurocat.org/ko/ 입니다.' },
      ],
    },
    es: {
      title: 'Aviso oficial de seguridad de KuroCat — Alerta sobre el sitio falso kurocat.net (ZIP sospechoso de 64 MB)',
      description: 'https://kurocat.org/ (github.com/qianyiai/KuroCat) es el ÚNICO sitio oficial de KuroCat. Consulta las pruebas forenses e indicadores de compromiso (IoC) que demuestran que el suplantador kurocat.net distribuye un ZIP alterado de 64.25 MB (KuroCat.v5.1.0.zip).',
      eyebrow: 'Aviso de seguridad · Verificación oficial y alerta de suplantación',
      h1: 'Aviso oficial de seguridad: evita el sitio falso kurocat.net',
      lead: 'KuroCat es mantenido exclusivamente por Qianyi (@qianyiai). Un dominio suplantador sin relación alguna (kurocat.net) se hace pasar por KuroCat y entrega a usuarios de Windows un archivo relleno no autorizado de 64.25 MB. Confía únicamente en kurocat.org y github.com/qianyiai/KuroCat.',
      breadcrumb: 'Aviso de seguridad',
      officialTitle: '✅ ÚNICOS canales oficiales y de confianza',
      officialList: [
        'Sitio web oficial y CDN verificado: https://kurocat.org/es/ y https://kurocat.org/es/download/',
        'Repositorio y Releases oficiales en GitHub: https://github.com/qianyiai/KuroCat',
        'Homebrew Tap oficial de macOS: https://github.com/qianyiai/homebrew-tap (brew install --cask qianyiai/tap/kurocat)',
      ],
      iocTitle: '🚨 Comparativa forense: KuroCat oficial vs suplantador kurocat.net',
      iocIntro: 'Registrado el 2026-11-24, kurocat.net enlaza las descargas de otros sistemas operativos a nuestro GitHub real como señuelo, mientras sustituye la descarga principal de Windows 10/11 por un archivo sospechoso alojado en su propio servidor:',
      cols: ['Atributo', 'KuroCat oficial (kurocat.org / GitHub)', 'Suplantador (kurocat.net)'],
      rows: [
        ['Afiliación oficial', '✅ Único sitio oficial y repositorio del autor', '❌ Sitio suplantador sin vínculo alguno'],
        ['Paquete Windows 10/11', 'KuroCat-5.1.3-x64-setup.exe (v5.1.0 era un .exe de 2.16 MB)', 'KuroCat.v5.1.0.zip (¡nunca publicado por KuroCat!)'],
        ['Tamaño de descarga', '2.40 MB (Rust nativo + Tauri v2)', '64.25 MB (67,371,456 bytes — inflado ~30 veces)'],
        ['Binario ejecutable', 'Binario nativo en Rust (~5–6 MB descomprimido)', 'KuroCat.exe no autorizado de 35.92 MB (CRC32: 0e67ba17)'],
        ['Relleno de evasión', 'Cero archivos basura .pak / .dat', 'bin/resources.pak (exactamente 48.00 MiB STORED) + bin/versions.dat (exactamente 2.00 MiB STORED) — técnica clásica de malware para evadir límites de tamaño en antivirus/sandboxes'],
        ['SHA-256 del ZIP sospechoso', 'Todos los hashes oficiales en /es/download/', '19ad10c48a7448584f1d00aa086f52b38231bacd659f04e83d3cefc60209796d'],
      ],
      remedyTitle: '🛡️ Qué hacer si descargaste o ejecutaste archivos de kurocat.net',
      remedySteps: [
        'Desconecta inmediatamente de internet el equipo Windows afectado.',
        'Elimina KuroCat.v5.1.0.zip y cualquier carpeta extraída.',
        'Ejecuta un análisis completo con Microsoft Defender Offline y una segunda herramienta antimalware de confianza.',
        'Desde otro dispositivo limpio, cambia tus contraseñas, cierra todas las sesiones activas del navegador y revoca tokens API, claves SSH o credenciales de billeteras almacenadas en ese PC.',
        'Descarga KuroCat ÚNICAMENTE desde https://kurocat.org/es/download/ o https://github.com/qianyiai/KuroCat/releases y verifica su SHA-256.',
      ],
      faqs: [
        { q: '¿Es kurocat.net oficial o seguro para descargar?', a: 'No. kurocat.net no tiene relación alguna con KuroCat y distribuye un ZIP no autorizado de 64.25 MB con 50 MiB de relleno sin comprimir y un ejecutable desconocido de 35.92 MB. Usa solo https://kurocat.org/es/ o https://github.com/qianyiai/KuroCat.' },
        { q: '¿Por qué el ZIP falso incluye un resources.pak de 48 MiB y un versions.dat de 2 MiB?', a: 'El KuroCat oficial no tiene esos archivos y pesa solo ~2.4 MB. Inflar un archivo por encima de 64 MB con datos sin comprimir es una técnica conocida de malware/infostealers para evadir límites de subida a antivirus en la nube y sandboxes.' },
        { q: '¿Cómo verifico con un solo comando que descargué el KuroCat oficial?', a: 'Ejecuta en PowerShell Get-FileHash KuroCat-5.1.3-x64-setup.exe -Algorithm SHA256 y comprueba que coincida exactamente con el hash de 64 caracteres publicado en https://kurocat.org/es/download/ y GitHub Releases.' },
      ],
    },
    pt: {
      title: 'Aviso oficial de segurança do KuroCat — Alerta contra o site falso kurocat.net (ZIP suspeito de 64 MB)',
      description: 'https://kurocat.org/ (github.com/qianyiai/KuroCat) é o ÚNICO site oficial do KuroCat. Veja as evidências forenses e IoCs que comprovam que o impostor kurocat.net distribui um ZIP adulterado de 64,25 MB (KuroCat.v5.1.0.zip).',
      eyebrow: 'Aviso de segurança · Verificação oficial e alerta de golpe',
      h1: 'Aviso oficial de segurança: evite o site falso kurocat.net',
      lead: 'O KuroCat é mantido exclusivamente por Qianyi (@qianyiai). Um domínio impostor sem qualquer vínculo (kurocat.net) está se passando pelo KuroCat e entregando a usuários Windows um arquivo inflado não autorizado de 64,25 MB. Confie apenas em kurocat.org e github.com/qianyiai/KuroCat.',
      breadcrumb: 'Aviso de segurança',
      officialTitle: '✅ ÚNICOS canais oficiais e confiáveis',
      officialList: [
        'Site oficial e CDN verificado: https://kurocat.org/pt/ e https://kurocat.org/pt/download/',
        'Repositório e Releases oficiais no GitHub: https://github.com/qianyiai/KuroCat',
        'Homebrew Tap oficial para macOS: https://github.com/qianyiai/homebrew-tap (brew install --cask qianyiai/tap/kurocat)',
      ],
      iocTitle: '🚨 Comparativo forense: KuroCat oficial vs impostor kurocat.net',
      iocIntro: 'Registrado em 2026-11-24, o kurocat.net aponta os downloads de outros sistemas para o nosso GitHub verdadeiro como disfarce, mas substitui o download principal de Windows 10/11 por um arquivo suspeito hospedado por eles:',
      cols: ['Atributo', 'KuroCat oficial (kurocat.org / GitHub)', 'Impostor (kurocat.net)'],
      rows: [
        ['Vínculo oficial', '✅ Único site oficial e repositório do autor', '❌ Site impostor sem qualquer afiliação'],
        ['Pacote Windows 10/11', 'KuroCat-5.1.3-x64-setup.exe (v5.1.0 era .exe de 2,16 MB)', 'KuroCat.v5.1.0.zip (nunca publicado pelo KuroCat!)'],
        ['Tamanho do download', '2,40 MB (Rust nativo + Tauri v2)', '64,25 MB (67.371.456 bytes — inflado ~30 vezes)'],
        ['Binário executável', 'Binário nativo Rust (~5–6 MB descompactado)', 'KuroCat.exe não autorizado de 35,92 MB (CRC32: 0e67ba17)'],
        ['Preenchimento de evasão', 'Nenhum arquivo lixo .pak / .dat', 'bin/resources.pak (exatos 48,00 MiB STORED) + bin/versions.dat (exatos 2,00 MiB STORED) — técnica clássica de malware para burlar limites de antivírus/sandboxes'],
        ['SHA-256 do ZIP suspeito', 'Todos os hashes oficiais em /pt/download/', '19ad10c48a7448584f1d00aa086f52b38231bacd659f04e83d3cefc60209796d'],
      ],
      remedyTitle: '🛡️ O que fazer se você baixou ou executou arquivos de kurocat.net',
      remedySteps: [
        'Desconecte imediatamente o PC Windows afetado da internet.',
        'Exclua KuroCat.v5.1.0.zip e qualquer pasta extraída.',
        'Execute uma verificação completa com o Microsoft Defender Offline e uma segunda ferramenta antimalware confiável.',
        'Em outro dispositivo limpo, troque suas senhas, encerre sessões ativas do navegador e revogue tokens de API, chaves SSH ou credenciais de carteiras salvas no PC afetado.',
        'Baixe o KuroCat APENAS em https://kurocat.org/pt/download/ ou https://github.com/qianyiai/KuroCat/releases e valide o SHA-256.',
      ],
      faqs: [
        { q: 'O site kurocat.net é oficial ou seguro para baixar?', a: 'Não. O kurocat.net não tem nenhuma relação com o KuroCat e distribui um ZIP não autorizado de 64,25 MB inflado com 50 MiB de lixo sem compressão e um executável desconhecido de 35,92 MB. Use somente https://kurocat.org/pt/ ou https://github.com/qianyiai/KuroCat.' },
        { q: 'Por que o ZIP falso contém resources.pak de 48 MiB e versions.dat de 2 MiB?', a: 'O KuroCat oficial não usa esses arquivos e pesa apenas ~2,4 MB. Inflar um pacote acima de 64 MB com dados não compactados é técnica conhecida de malware/infostealers para escapar de limites de análise em nuvem e sandboxes.' },
        { q: 'Como conferir com um comando se baixei o KuroCat original?', a: 'No PowerShell, rode Get-FileHash KuroCat-5.1.3-x64-setup.exe -Algorithm SHA256 e confirme que o resultado bate exatamente com o hash publicado em https://kurocat.org/pt/download/ e no GitHub Releases.' },
      ],
    },
    ru: {
      title: 'Официальное предупреждение безопасности KuroCat — Фейковый сайт kurocat.net (подозрительный ZIP 64 МБ)',
      description: 'https://kurocat.org/ (github.com/qianyiai/KuroCat) — ЕДИНСТВЕННЫЙ официальный сайт KuroCat. Изучите доказательства и индикаторы компрометации (IoC): клон-сайт kurocat.net распространяет поддельный раздутый ZIP на 64,25 МБ (KuroCat.v5.1.0.zip).',
      eyebrow: 'Предупреждение безопасности · Официальная проверка и защита от фейка',
      h1: 'Официальное предупреждение: остерегайтесь фейкового сайта kurocat.net',
      lead: 'KuroCat разрабатывается и поддерживается исключительно Qianyi (@qianyiai). Посторонний фейковый домен kurocat.net выдаёт себя за KuroCat и подсовывает пользователям Windows неавторизованный раздутый архив на 64,25 МБ. Доверяйте только kurocat.org и github.com/qianyiai/KuroCat.',
      breadcrumb: 'Безопасность',
      officialTitle: '✅ ЕДИНСТВЕННЫЕ официальные и доверенные каналы',
      officialList: [
        'Официальный сайт и проверенный CDN: https://kurocat.org/ru/ и https://kurocat.org/ru/download/',
        'Официальный репозиторий и релизы GitHub: https://github.com/qianyiai/KuroCat',
        'Официальный Homebrew Tap для macOS: https://github.com/qianyiai/homebrew-tap (brew install --cask qianyiai/tap/kurocat)',
      ],
      iocTitle: '🚨 Технический разбор: официальный KuroCat против фейка kurocat.net',
      iocIntro: 'Зарегистрированный 2026-11-24 сайт kurocat.net для маскировки ссылается на наш настоящий GitHub для других ОС, но подменяет главную кнопку загрузки Windows 10/11 на собственный подозрительный архив:',
      cols: ['Параметр', 'Официальный KuroCat (kurocat.org / GitHub)', 'Фейковый сайт (kurocat.net)'],
      rows: [
        ['Официальный статус', '✅ Единственный официальный сайт и репозиторий автора', '❌ Сторонний сайт-подделка без связи с автором'],
        ['Файл для Windows 10/11', 'KuroCat-5.1.3-x64-setup.exe (в v5.1.0 был .exe 2,16 МБ)', 'KuroCat.v5.1.0.zip (такой ZIP никогда не выпускался!)'],
        ['Размер загрузки', '2,40 МБ (нативный Rust + Tauri v2)', '64,25 МБ (67 371 456 байт — раздут почти в 30 раз)'],
        ['Исполняемый файл', 'Нативный бинарник Rust (~5–6 МБ после распаковки)', 'Неизвестный KuroCat.exe на 35,92 МБ (CRC32: 0e67ba17)'],
        ['Мусорное наполнение (обход АВ)', 'Никаких мусорных .pak / .dat файлов', 'bin/resources.pak (ровно 48,00 МиБ STORED) + bin/versions.dat (ровно 2,00 МиБ STORED) — типичный приём малвари для обхода лимитов размера антивирусов и песочниц'],
        ['SHA-256 подозрительного ZIP', 'Все официальные хеши на /ru/download/', '19ad10c48a7448584f1d00aa086f52b38231bacd659f04e83d3cefc60209796d'],
      ],
      remedyTitle: '🛡️ Что делать, если вы скачали или запустили файл с kurocat.net',
      remedySteps: [
        'Немедленно отключите затронутый ПК на Windows от сети и интернета.',
        'Полностью удалите KuroCat.v5.1.0.zip и все распакованные из него папки.',
        'Запустите полную автономную проверку Microsoft Defender Offline и дополнительную проверку надёжным антивирусом.',
        'С другого чистого устройства смените важные пароли, завершите активные сессии браузера и отзовите API-токены, SSH-ключи и доступы к криптокошелькам, хранившиеся на этом ПК.',
        'Скачивайте KuroCat ТОЛЬКО с https://kurocat.org/ru/download/ или https://github.com/qianyiai/KuroCat/releases и сверяйте SHA-256.',
      ],
      faqs: [
        { q: 'Является ли kurocat.net официальным или безопасным сайтом?', a: 'Нет. kurocat.net никак не связан с KuroCat и распространяет поддельный ZIP на 64,25 МБ с 50 МиБ несжатого мусора и неизвестным 35,92 МБ exe-файлом. Используйте только https://kurocat.org/ru/ или https://github.com/qianyiai/KuroCat.' },
        { q: 'Зачем в поддельном ZIP файлы resources.pak (48 МиБ) и versions.dat (2 МиБ)?', a: 'В официальном KuroCat таких файлов нет, а установщик весит ~2,4 МБ. Раздувание архива свыше 64 МБ несжатыми данными — известный приём стилеров и троянов для обхода ограничений размера облачных антивирусов и песочниц.' },
        { q: 'Как одной командой проверить подлинность установщика KuroCat?', a: 'Выполните в PowerShell команду Get-FileHash KuroCat-5.1.3-x64-setup.exe -Algorithm SHA256 и убедитесь, что 64-символьный хеш полностью совпадает со страницей https://kurocat.org/ru/download/ и GitHub Releases.' },
      ],
    },
    de: {
      title: 'Offizieller KuroCat-Sicherheitshinweis — Warnung vor Fake-Seite kurocat.net (64-MB-Malware-Verdacht)',
      description: 'https://kurocat.org/ (github.com/qianyiai/KuroCat) ist die EINZIGE offizielle KuroCat-Website. Forensische Nachweise und IoCs zeigen, dass die Nachahmerseite kurocat.net ein manipuliertes 64,25-MB-ZIP (KuroCat.v5.1.0.zip) verteilt.',
      eyebrow: 'Sicherheitshinweis · Offizielle Prüfung & Betrugswarnung',
      h1: 'Offizieller Sicherheitshinweis: Meide die Fake-Seite kurocat.net',
      lead: 'KuroCat wird ausschließlich von Qianyi (@qianyiai) gepflegt. Eine nicht verbundene Nachahmer-Domain (kurocat.net) gibt sich als KuroCat aus und liefert Windows-Nutzern ein nicht autorisiertes, aufgeblähtes 64,25-MB-Archiv aus. Vertraue nur kurocat.org und github.com/qianyiai/KuroCat.',
      breadcrumb: 'Sicherheitshinweis',
      officialTitle: '✅ EINZIGE offizielle und vertrauenswürdige Kanäle',
      officialList: [
        'Offizielle Website & verifiziertes CDN: https://kurocat.org/de/ und https://kurocat.org/de/download/',
        'Offizielles GitHub-Repository & Releases: https://github.com/qianyiai/KuroCat',
        'Offizieller macOS Homebrew Tap: https://github.com/qianyiai/homebrew-tap (brew install --cask qianyiai/tap/kurocat)',
      ],
      iocTitle: '🚨 Forensischer Vergleich: Offizielles KuroCat vs. Fake-Seite kurocat.net',
      iocIntro: 'Die am 2026-11-24 registrierte Domain kurocat.net verlinkt andere Betriebssysteme zur Tarnung auf unser echtes GitHub, tauscht aber ausgerechnet den Hauptdownload für Windows 10/11 gegen ein selbst gehostetes verdächtiges Archiv aus:',
      cols: ['Merkmal', 'Offizielles KuroCat (kurocat.org / GitHub)', 'Nachahmerseite (kurocat.net)'],
      rows: [
        ['Offizielle Zugehörigkeit', '✅ Einzige offizielle Website & Autoren-Repository', '❌ Unbefugte Nachahmerseite ohne Verbindung'],
        ['Windows-10/11-Paket', 'KuroCat-5.1.3-x64-setup.exe (v5.1.0 war eine 2,16-MB-.exe)', 'KuroCat.v5.1.0.zip (niemals von KuroCat veröffentlicht!)'],
        ['Download-Größe', '2,40 MB (natives Rust + Tauri v2)', '64,25 MB (67.371.456 Bytes — ca. 30-fach aufgebläht)'],
        ['Ausführbare Datei', 'Native Rust-Binary (~5–6 MB entpackt)', 'Unautorisierte 35,92-MB-KuroCat.exe (CRC32: 0e67ba17)'],
        ['Tarn-Padding (AV-Umgehung)', 'Keinerlei .pak- / .dat-Fülldateien', 'bin/resources.pak (exakt 48,00 MiB STORED) + bin/versions.dat (exakt 2,00 MiB STORED) — klassische Malware-Technik zur Umgehung von AV-/Sandbox-Größenlimits'],
        ['SHA-256 des verdächtigen ZIP', 'Alle offiziellen Hashes unter /de/download/', '19ad10c48a7448584f1d00aa086f52b38231bacd659f04e83d3cefc60209796d'],
      ],
      remedyTitle: '🛡️ Was tun, wenn du Dateien von kurocat.net heruntergeladen oder ausgeführt hast?',
      remedySteps: [
        'Trenne den betroffenen Windows-PC sofort vom Internet und Netzwerk.',
        'Lösche KuroCat.v5.1.0.zip sowie alle entpackten Ordner vollständig.',
        'Führe einen vollständigen Microsoft-Defender-Offline-Scan sowie eine Zweitprüfung mit einem seriösen Anti-Malware-Scanner durch.',
        'Ändere von einem anderen, sauberen Gerät aus deine Passwörter, beende aktive Browser-Sitzungen und widerrufe alle auf dem PC gespeicherten API-Tokens, SSH-Schlüssel oder Krypto-Wallet-Zugänge.',
        'Lade KuroCat NUR über https://kurocat.org/de/download/ oder https://github.com/qianyiai/KuroCat/releases herunter und prüfe die SHA-256-Summe.',
      ],
      faqs: [
        { q: 'Ist kurocat.net offiziell oder sicher zum Herunterladen?', a: 'Nein. kurocat.net steht in keinerlei Verbindung zu KuroCat und verbreitet ein nicht autorisiertes 64,25-MB-ZIP mit 50 MiB unkomprimiertem Datenmüll und einer unbekannten 35,92-MB-EXE. Nutze ausschließlich https://kurocat.org/de/ oder https://github.com/qianyiai/KuroCat.' },
        { q: 'Warum enthält das Fake-ZIP eine 48-MiB-resources.pak und eine 2-MiB-versions.dat?', a: 'Das offizielle KuroCat besitzt solche Dateien nicht und ist nur ~2,4 MB groß. Das Aufblähen über 64 MB mit unkomprimierten Daten ist eine bekannte Methode von Malware und Infostealern, um Upload- und Scan-Größenlimits von Cloud-Antiviren und Sandboxes zu umgehen.' },
        { q: 'Wie prüfe ich mit einem Befehl, ob mein KuroCat-Download echt ist?', a: 'Führe in PowerShell Get-FileHash KuroCat-5.1.3-x64-setup.exe -Algorithm SHA256 aus und vergleiche den 64-stelligen Hash mit https://kurocat.org/de/download/ und GitHub Releases.' },
      ],
    },
  }[locale];

  const bodyHtml = `
    <section class="card">
      <h2>${esc(copy.officialTitle)}</h2>
      <ul>
        ${copy.officialList.map((li) => `<li><strong>${esc(li)}</strong></li>`).join('\n        ')}
      </ul>
    </section>

    <section class="card">
      <h2>${esc(copy.iocTitle)}</h2>
      <p>${esc(copy.iocIntro)}</p>
      <div class="table-wrap">
        <table>
          <thead><tr>${copy.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>
            ${copy.rows.map((r) => `<tr><td><strong>${esc(r[0])}</strong></td><td class="badge-yes">${esc(r[1])}</td><td class="badge-no">${esc(r[2])}</td></tr>`).join('\n            ')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>${esc(copy.remedyTitle)}</h2>
      <ol>
        ${copy.remedySteps.map((s) => `<li>${esc(s)}</li>`).join('\n        ')}
      </ol>
    </section>
  `;

  return renderPage({
    locale,
    slug: 'security',
    title: copy.title,
    description: copy.description,
    eyebrow: copy.eyebrow,
    h1: copy.h1,
    lead: copy.lead,
    breadcrumbLabel: copy.breadcrumb,
    bodyHtml,
    faqs: copy.faqs,
    howToSteps: null,
    today,
  });
}

export function generateAllSubpages(distDir, today) {
  const builders = {
    download: buildDownloadPage,
    'vs/bongo-cat': buildVsBongoCatPage,
    obs: buildObsPage,
    mcp: buildMcpPage,
    security: buildSecurityPage,
  };
  let count = 0;
  for (const slug of SUBPAGE_SLUGS) {
    for (const locale of LOCALES) {
      const html = builders[slug](locale, today);
      const relDir = locale === 'zh' ? slug : path.join(locale, slug);
      const outDir = path.join(distDir, relDir);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
      count += 1;
    }
  }
  return count;
}

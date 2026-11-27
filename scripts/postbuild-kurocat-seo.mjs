#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUBPAGE_SLUGS, generateAllSubpages } from './generate-kurocat-subpages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist-web');
const indexPath = path.join(distDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  throw new Error(`Missing built website index: ${indexPath}`);
}

const baseHtml = fs.readFileSync(indexPath, 'utf8');
const today = new Date().toISOString().slice(0, 10);
const INDEXNOW_KEY = '72c2aa7ff4741b82f312c69a890863c1';

const LOCALE_PAGES = [
  {
    code: 'en',
    htmlLang: 'en',
    ogLocale: 'en_US',
    shortLabel: 'EN',
    url: 'https://kurocat.org/en/',
    siteName: 'KuroCat Official',
    title: 'KuroCat Official — Free Open-Source 3D Desktop Typing Cat & AI Companion (Win/Mac/Linux/Android)',
    description:
      'KuroCat Official Website (kurocat.org · github.com/qianyiai/KuroCat) — Free open-source 3D/2D transparent desktop typing cat & AI coding companion (Bongo Cat alternative) for Windows, macOS (Homebrew), Linux & Android: 6 cats + BigFish, Claude/Codex/DeepSeek status sync, OBS transparent source, password privacy guard & built-in MCP AI studio.',
    ogTitle: 'KuroCat Official — Free Open-Source 3D/2D Desktop Typing Cat & AI Companion',
    ogDescription:
      'Official Website of KuroCat (kurocat.org · github.com/qianyiai/KuroCat): Free open-source 3D/2D Tauri v2 + Rust desktop typing cat & AI companion for Windows, macOS (Homebrew), Linux & Android.',
    heroTitle: 'KuroCat — A Typing Black Cat<br />\n          <span>Living on Your Desktop</span>',
    heroSub:
      'A free, open-source transparent desktop typing companion with instant <strong>3D / 2D</strong> switching and ultra-low GPU overhead. Includes <strong>6 cats + BigFish</strong>, head-pat purring, password privacy guard, OBS overlay, and <strong>AI cat studio</strong>.',
    dlTitle: 'Free Download — On Your Desk in 3 Seconds',
    dlSub:
      'Every build includes <strong>20%–150% smooth scaling</strong>, <strong>65% / 108-key switching</strong>, <strong>customizable tail keys</strong>, and <strong>in-app auto-updates</strong>.<br />\n          Fast official CDN mirrors on <code>kurocat.org</code> alongside official GitHub Releases with SHA-256 verification.',
    featTitle: 'A Desktop Pet Crafted to Obsessive Silkiness',
    mcpHeadline: 'Share a Photo of Your Cat<br />AI Sculpts It in 0.4 Seconds',
    growthTitle: 'Live Growth Curve',
    faqOfficialQ: 'What is the only official website and download source for KuroCat?',
    faqOfficialA:
      'KuroCat is developed and maintained exclusively by Qianyi (@qianyiai). The only official website is https://kurocat.org/, the official GitHub repository is https://github.com/qianyiai/KuroCat, and the official macOS Homebrew Tap is https://github.com/qianyiai/homebrew-tap. Third-party domains such as kurocat.net or unofficial forks are not affiliated with the author.',
    footerLinks: {
      download: 'All-Platform Downloads',
      vsBongo: 'KuroCat vs Bongo Cat',
      obs: 'OBS Transparent Guide',
      mcp: 'AI MCP Studio',
      security: 'Security Advisory',
    },
    alert: {
      badge: 'ONLY OFFICIAL SITE',
      text: '<strong>kurocat.org</strong> is the ONLY official KuroCat website (<code>github.com/qianyiai/KuroCat</code>). ⚠️ WARNING: Impersonator <strong>kurocat.net</strong> distributes an unauthorized 64 MB <code>KuroCat.v5.1.0.zip</code> padded with 50 MiB junk &amp; a fake 36 MB binary — do NOT download or run it!',
      cta: 'Security Advisory →',
      close: 'Dismiss notice',
    },
  },
  {
    code: 'ja',
    htmlLang: 'ja',
    ogLocale: 'ja_JP',
    shortLabel: '日本語',
    url: 'https://kurocat.org/ja/',
    siteName: 'KuroCat 公式サイト',
    title: 'KuroCat 公式サイト — 無料オープンソース 3D デスクトップタイピング黒猫 & AI コンパニオン (Win/Mac/Linux/Android)',
    description:
      'KuroCat 公式サイト（kurocat.org · github.com/qianyiai/KuroCat）— Windows / macOS (Homebrew) / Linux / Android 対応の無料オープンソース 3D/2D 透過デスクトップタイピング黒猫＆AI コーディングコンパニオン（Bongo Cat 代替）。猫 6 種＋クジラ娘、Claude/Codex/DeepSeek 連携、OBS 透過ソース、パスワード保護、内蔵 MCP AI カスタム対応。',
    ogTitle: 'KuroCat 公式サイト — 無料オープンソース 3D/2D デスクトップタイピング黒猫 & AI コンパニオン',
    ogDescription:
      'KuroCat 公式ホームページ（kurocat.org · github.com/qianyiai/KuroCat）：Windows / macOS (Homebrew) / Linux / Android 対応の無料オープンソース 3D/2D 透過デスクトップタイピング黒猫＆AI コンパニオン。',
    heroTitle: 'KuroCat · キーボードを叩く黒猫が<br />\n          <span>あなたのデスクトップに</span>',
    heroSub:
      '無料・オープンソースの透過デスクトップ相棒。<strong>3D / 2D</strong> をワンクリックで切替でき、ゲーム中も超低負荷で動作します。<strong>猫 6 種 + クジラ娘</strong>、なでなでゴロゴロ、パスワード自動保護、OBS 透過配信、<strong>AI カスタム猫</strong> に対応。',
    dlTitle: '無料ダウンロード、3 秒でデスクトップへ',
    dlSub:
      '全パッケージに <strong>20%–150% 無段階ズーム</strong>・<strong>65% / 108 キー切替</strong>・<strong>しっぽキー選択</strong>・<strong>アプリ内自動更新</strong> を内蔵。<br />\n          <code>kurocat.org</code> 公式高速ミラーと GitHub Releases 公式リンク（SHA-256 検証対応）を用意しています。',
    featTitle: '徹底的に磨き上げた、なめらかなデスクトップ相棒',
    mcpHeadline: '愛猫の写真から<br />AI が 0.4 秒でデスクトップへ再現',
    growthTitle: 'リアルタイム成長グラフ',
    faqOfficialQ: 'KuroCat の唯一の公式サイトと正規ダウンロード元はどこですか？',
    faqOfficialA:
      'KuroCat の唯一の公式サイトは https://kurocat.org/ 、公式 GitHub リポジトリは https://github.com/qianyiai/KuroCat 、公式 macOS Homebrew Tap は https://github.com/qianyiai/homebrew-tap です。kurocat.net などの第三者ドメインや非公式フォークは作者と無関係です。',
    footerLinks: {
      download: '全プラットフォーム DL',
      vsBongo: 'Bongo Cat 比較',
      obs: 'OBS 透過配信ガイド',
      mcp: 'AI MCP カスタム',
      security: '偽サイト注意・セキュリティ',
    },
    alert: {
      badge: '唯一の公式サイト',
      text: '<strong>kurocat.org</strong> が KuroCat 唯一の公式サイトです（<code>github.com/qianyiai/KuroCat</code>）。⚠️ 偽サイト <strong>kurocat.net</strong> の 64 MB <code>KuroCat.v5.1.0.zip</code> は 50 MiB の異常パディングと非公式 36 MB 実行ファイルを含む危険な偽ビルドのため絶対に実行しないでください！',
      cta: '偽サイト警告・検証 →',
      close: 'お知らせを閉じる',
    },
  },
  {
    code: 'ko',
    htmlLang: 'ko',
    ogLocale: 'ko_KR',
    shortLabel: '한국어',
    url: 'https://kurocat.org/ko/',
    siteName: 'KuroCat 공식 사이트',
    title: 'KuroCat 공식 사이트 — 무료 오픈소스 3D 바탕화면 타이핑 검은 고양이 & AI 컴패니언 (Win/Mac/Linux/Android)',
    description:
      'KuroCat 공식 웹사이트(kurocat.org · github.com/qianyiai/KuroCat) — Windows, macOS (Homebrew), Linux, Android를 지원하는 무료 오픈소스 3D/2D 투명 바탕화면 타이핑 검은 고양이 & AI 코딩 컴패니언(Bongo Cat 대안). 고양이 6종 + 고래소녀, Claude/Codex/DeepSeek 연동, OBS 투명 소스, 비밀번호 자동 눈 가리기, 내장 MCP AI 커스텀 지원.',
    ogTitle: 'KuroCat 공식 사이트 — 무료 오픈소스 3D/2D 바탕화면 타이핑 검은 고양이 & AI 컴패니언',
    ogDescription:
      'KuroCat 공식 웹사이트(kurocat.org · github.com/qianyiai/KuroCat): Windows, macOS (Homebrew), Linux, Android 지원 무료 오픈소스 3D/2D 투명 데스크톱 타이핑 검은 고양이 & AI 컴패니언.',
    heroTitle: 'KuroCat · 키보드를 치는 검은 고양이<br />\n          <span>내 바탕화면에 살아요</span>',
    heroSub:
      '무료 오픈소스 투명 바탕화면 키보드·마우스 펫. <strong>3D 피규어 / 2D 클래식</strong> 원클릭 전환과 초저사양 GPU 최적화로 게임 중에도 가볍게 동작합니다. <strong>고양이 6종 + 고래소녀</strong>, 쓰다듬기 골골송, 비밀번호 눈 가리기, OBS 투명 방송, <strong>AI 펫 커스텀</strong>을 지원합니다.',
    dlTitle: '무료 다운로드, 3초 만에 내 바탕화면으로',
    dlSub:
      '모든 패키지에 <strong>20%–150% 자유 크기 조절</strong>, <strong>65% / 108키 즉시 전환</strong>, <strong>커스텀 꼬리 타건</strong>, <strong>앱 내 자동 업데이트</strong>가 기본 포함됩니다.<br />\n          <code>kurocat.org</code> 공식 고속 CDN 미러와 SHA-256 검증을 지원하는 GitHub Releases 공식 링크를 함께 제공합니다.',
    featTitle: '픽셀 하나까지 매끄럽게 다듬은 데스크톱 펫',
    mcpHeadline: '반려묘 사진 한 장이면<br />AI가 0.4초 만에 바탕화면에 제작',
    growthTitle: '실시간 성장 그래프',
    faqOfficialQ: 'KuroCat의 유일한 공식 사이트와 정식 다운로드 경로는 어디인가요?',
    faqOfficialA:
      'KuroCat의 유일한 공식 웹사이트는 https://kurocat.org/ 이며, 공식 GitHub 저장소는 https://github.com/qianyiai/KuroCat , 공식 macOS Homebrew Tap은 https://github.com/qianyiai/homebrew-tap 입니다. kurocat.net 등 제3자 도메인이나 비공식 포크는 제작자와 무관합니다.',
    footerLinks: {
      download: '전체 플랫폼 다운로드',
      vsBongo: 'Bongo Cat 비교',
      obs: 'OBS 투명 방송 가이드',
      mcp: 'AI MCP 커스텀',
      security: '사칭 주의·보안 공지',
    },
    alert: {
      badge: '유일한 공식 사이트',
      text: '<strong>kurocat.org</strong>는 KuroCat의 유일한 공식 사이트입니다 (<code>github.com/qianyiai/KuroCat</code>). ⚠️ 사칭 사이트 <strong>kurocat.net</strong>의 64 MB <code>KuroCat.v5.1.0.zip</code>에는 비공식 36 MB 실행 파일과 50 MiB 패딩이 포함되어 있어 악성코드 위험이 높으니 절대 실행하지 마세요!',
      cta: '보안 공지·검증 →',
      close: '공지 닫기',
    },
  },
  {
    code: 'es',
    htmlLang: 'es',
    ogLocale: 'es_ES',
    shortLabel: 'ES',
    url: 'https://kurocat.org/es/',
    siteName: 'KuroCat Oficial',
    title: 'KuroCat Oficial — Gato negro 3D gratis y open source en tu escritorio y compañero IA (Win/Mac/Linux/Android)',
    description:
      'Sitio web oficial de KuroCat (kurocat.org · github.com/qianyiai/KuroCat) — Gato 3D/2D transparente de escritorio que escribe contigo y compañero IA de código abierto (alternativa a Bongo Cat) para Windows, macOS (Homebrew), Linux y Android: 6 gatos + BigFish, sincronización Claude/Codex/DeepSeek, overlay OBS transparente, privacidad de contraseñas y estudio MCP integrado.',
    ogTitle: 'KuroCat Oficial — Gato 3D/2D gratis y open source de escritorio y compañero IA',
    ogDescription:
      'Sitio oficial de KuroCat (kurocat.org · github.com/qianyiai/KuroCat): gato 3D/2D transparente en Tauri v2 + Rust y compañero IA gratis y open source para Windows, macOS (Homebrew), Linux y Android.',
    heroTitle: 'KuroCat — Un gato negro tecleando<br />\n          <span>viviendo en tu escritorio</span>',
    heroSub:
      'Compañero transparente de escritorio gratis y open source con cambio al instante entre <strong>3D / 2D</strong> y consumo mínimo de GPU. Incluye <strong>6 gatos + BigFish</strong>, ronroneo al acariciar, privacidad de contraseñas, overlay OBS y <strong>estudio IA de gatos</strong>.',
    dlTitle: 'Descarga gratis — En tu escritorio en 3 segundos',
    dlSub:
      'Cada paquete incluye <strong>zoom fluido 20%–150%</strong>, <strong>teclado 65% / 108 teclas</strong>, <strong>teclas de cola personalizables</strong> y <strong>actualización automática</strong>.<br />\n          CDN oficial rápido en <code>kurocat.org</code> junto con GitHub Releases oficiales verificados con SHA-256.',
    featTitle: 'Una mascota de escritorio pulida hasta la obsesión',
    mcpHeadline: 'Comparte una foto de tu gato<br />la IA lo esculpe en 0.4 segundos',
    growthTitle: 'Curva de crecimiento en vivo',
    faqOfficialQ: '¿Cuál es el único sitio web y canal oficial de descarga de KuroCat?',
    faqOfficialA:
      'KuroCat es desarrollado y mantenido exclusivamente por Qianyi (@qianyiai). El único sitio web oficial es https://kurocat.org/, el repositorio oficial de GitHub es https://github.com/qianyiai/KuroCat y el Homebrew Tap oficial para macOS es https://github.com/qianyiai/homebrew-tap. Dominios de terceros como kurocat.net o forks no oficiales no están afiliados al autor.',
    footerLinks: {
      download: 'Descargas para todos los OS',
      vsBongo: 'KuroCat vs Bongo Cat',
      obs: 'Guía transparente OBS',
      mcp: 'Estudio IA & MCP',
      security: 'Aviso de seguridad',
    },
    alert: {
      badge: 'ÚNICO SITIO OFICIAL',
      text: '<strong>kurocat.org</strong> es el ÚNICO sitio oficial de KuroCat (<code>github.com/qianyiai/KuroCat</code>). ⚠️ AVISO: El suplantador <strong>kurocat.net</strong> distribuye un <code>KuroCat.v5.1.0.zip</code> no autorizado de 64 MB con 50 MiB de relleno y un binario falso de 36 MB — ¡NO lo descargues ni ejecutes!',
      cta: 'Aviso de seguridad →',
      close: 'Cerrar aviso',
    },
  },
  {
    code: 'pt',
    htmlLang: 'pt-BR',
    ogLocale: 'pt_BR',
    shortLabel: 'PT',
    url: 'https://kurocat.org/pt/',
    siteName: 'KuroCat Oficial',
    title: 'KuroCat Oficial — Gato preto 3D grátis e open source no seu desktop e companheiro de IA (Win/Mac/Linux/Android)',
    description:
      'Site oficial do KuroCat (kurocat.org · github.com/qianyiai/KuroCat) — Gato 3D/2D transparente de desktop que digita com você e companheiro de código com IA gratuito e open source (alternativa ao Bongo Cat) para Windows, macOS (Homebrew), Linux e Android: 6 gatos + BigFish, integração Claude/Codex/DeepSeek, overlay transparente no OBS, privacidade de senhas e estúdio MCP embutido.',
    ogTitle: 'KuroCat Oficial — Gato 3D/2D grátis e open source de desktop e companheiro de IA',
    ogDescription:
      'Site oficial do KuroCat (kurocat.org · github.com/qianyiai/KuroCat): gato 3D/2D transparente feito em Tauri v2 + Rust e companheiro de IA gratuito e open source para Windows, macOS (Homebrew), Linux e Android.',
    heroTitle: 'KuroCat — Um gato preto digitando<br />\n          <span>morando na sua área de trabalho</span>',
    heroSub:
      'Companheiro transparente de desktop grátis e open source com troca instantânea entre <strong>3D / 2D</strong> e uso ultrabaixo de GPU. Inclui <strong>6 gatos + BigFish</strong>, ronronado ao fazer carinho, proteção de senhas, overlay OBS e <strong>estúdio de gatos com IA</strong>.',
    dlTitle: 'Download grátis — Na sua tela em 3 segundos',
    dlSub:
      'Todas as versões trazem <strong>escala fluida de 20%–150%</strong>, <strong>teclado 65% / 108 teclas</strong>, <strong>teclas de cauda personalizáveis</strong> e <strong>atualização automática no app</strong>.<br />\n          CDN oficial rápido em <code>kurocat.org</code> junto com GitHub Releases oficiais com verificação SHA-256.',
    featTitle: 'Um pet de desktop polido nos mínimos detalhes',
    mcpHeadline: 'Envie a foto do seu gato<br />a IA recria em 0,4 segundo',
    growthTitle: 'Curva de crescimento ao vivo',
    faqOfficialQ: 'Qual é o único site oficial e canal legítimo de download do KuroCat?',
    faqOfficialA:
      'O KuroCat é desenvolvido e mantido exclusivamente por Qianyi (@qianyiai). O único site oficial é https://kurocat.org/, o repositório oficial no GitHub é https://github.com/qianyiai/KuroCat e o Homebrew Tap oficial para macOS é https://github.com/qianyiai/homebrew-tap. Domínios de terceiros como kurocat.net ou forks não oficiais não têm relação com o autor.',
    footerLinks: {
      download: 'Downloads para todas plataformas',
      vsBongo: 'KuroCat vs Bongo Cat',
      obs: 'Guia OBS transparente',
      mcp: 'Estúdio IA & MCP',
      security: 'Aviso de segurança',
    },
    alert: {
      badge: 'ÚNICO SITE OFICIAL',
      text: '<strong>kurocat.org</strong> é o ÚNICO site oficial do KuroCat (<code>github.com/qianyiai/KuroCat</code>). ⚠️ ALERTA: O impostor <strong>kurocat.net</strong> distribui um <code>KuroCat.v5.1.0.zip</code> não autorizado de 64 MB com 50 MiB de lixo e executável falso de 36 MB — NÃO baixe nem execute!',
      cta: 'Aviso de segurança →',
      close: 'Fechar aviso',
    },
  },
  {
    code: 'ru',
    htmlLang: 'ru',
    ogLocale: 'ru_RU',
    shortLabel: 'RU',
    url: 'https://kurocat.org/ru/',
    siteName: 'Официальный сайт KuroCat',
    title: 'Официальный сайт KuroCat — Бесплатный 3D-кот на клавиатуре и ИИ-компаньон с открытым кодом (Win/Mac/Linux/Android)',
    description:
      'Официальный сайт KuroCat (kurocat.org · github.com/qianyiai/KuroCat) — Бесплатный 3D/2D прозрачный кот на рабочий стол с открытым кодом и ИИ-компаньон для кодинга (альтернатива Bongo Cat) для Windows, macOS (Homebrew), Linux и Android: 6 котов + BigFish, синхронизация с Claude/Codex/DeepSeek, прозрачный оверлей OBS, защита паролей и встроенная ИИ-студия MCP.',
    ogTitle: 'Официальный сайт KuroCat — Бесплатный 3D/2D кот на клавиатуре и ИИ-компаньон с открытым кодом',
    ogDescription:
      'Официальный сайт KuroCat (kurocat.org · github.com/qianyiai/KuroCat): бесплатный 3D/2D прозрачный кот на Tauri v2 + Rust и ИИ-компаньон для Windows, macOS (Homebrew), Linux и Android.',
    heroTitle: 'KuroCat — Чёрный кот за клавиатурой<br />\n          <span>прямо на вашем рабочем столе</span>',
    heroSub:
      'Бесплатный прозрачный десктопный компаньон с открытым кодом, мгновенным переключением <strong>3D / 2D</strong> и минимальной нагрузкой на GPU. Внутри <strong>6 котов + BigFish</strong>, мурлыканье при поглаживании, скрытие паролей, оверлей OBS и <strong>ИИ-студия питомцев</strong>.',
    dlTitle: 'Скачать бесплатно — На рабочем столе за 3 секунды',
    dlSub:
      'Каждая сборка включает <strong>плавный масштаб 20%–150%</strong>, <strong>клавиатуру 65% / 108 клавиш</strong>, <strong>настройку клавиш для хвоста</strong> и <strong>автообновление</strong>.<br />\n          Быстрый официальный CDN на <code>kurocat.org</code> и официальные GitHub Releases с проверкой SHA-256.',
    featTitle: 'Десктопный питомец, доведённый до безупречной плавности',
    mcpHeadline: 'Покажите фото своего кота<br />ИИ создаст его за 0,4 секунды',
    growthTitle: 'График роста в реальном времени',
    faqOfficialQ: 'Какой единственный официальный сайт и источник загрузки KuroCat?',
    faqOfficialA:
      'KuroCat разрабатывается и поддерживается исключительно Qianyi (@qianyiai). Единственный официальный сайт — https://kurocat.org/, официальный репозиторий GitHub — https://github.com/qianyiai/KuroCat, официальный Homebrew Tap для macOS — https://github.com/qianyiai/homebrew-tap. Сторонние домены вроде kurocat.net и неофициальные форки не связаны с автором.',
    footerLinks: {
      download: 'Скачать для всех ОС',
      vsBongo: 'KuroCat vs Bongo Cat',
      obs: 'Гайд по OBS без фона',
      mcp: 'ИИ-студия и MCP',
      security: 'Предупреждение безопасности',
    },
    alert: {
      badge: 'ЕДИНСТВЕННЫЙ ОФИЦИАЛЬНЫЙ САЙТ',
      text: '<strong>kurocat.org</strong> — ЕДИНСТВЕННЫЙ официальный сайт KuroCat (<code>github.com/qianyiai/KuroCat</code>). ⚠️ ОСТОРОЖНО: фейковый сайт <strong>kurocat.net</strong> раздаёт поддельный 64 МБ <code>KuroCat.v5.1.0.zip</code> с 50 МиБ мусора и неизвестным 36 МБ exe — НЕ скачивайте и НЕ запускайте его!',
      cta: 'Безопасность и проверка →',
      close: 'Закрыть уведомление',
    },
  },
  {
    code: 'de',
    htmlLang: 'de',
    ogLocale: 'de_DE',
    shortLabel: 'DE',
    url: 'https://kurocat.org/de/',
    siteName: 'KuroCat Offiziell',
    title: 'KuroCat Offiziell — Kostenlose Open-Source-3D-Tipp-Katze & KI-Begleiter für den Desktop (Win/Mac/Linux/Android)',
    description:
      'Offizielle Website von KuroCat (kurocat.org · github.com/qianyiai/KuroCat) — Kostenlose transparente 3D/2D-Desktop-Tipp-Katze & KI-Coding-Begleiter als Open Source (Bongo-Cat-Alternative) für Windows, macOS (Homebrew), Linux & Android: 6 Katzen + BigFish, Claude/Codex/DeepSeek-Status, transparentes OBS-Overlay, Passwortschutz & integriertes MCP-KI-Studio.',
    ogTitle: 'KuroCat Offiziell — Kostenlose Open-Source-3D/2D-Desktop-Tipp-Katze & KI-Begleiter',
    ogDescription:
      'Offizielle Website von KuroCat (kurocat.org · github.com/qianyiai/KuroCat): kostenlose Open-Source-3D/2D-Tipp-Katze auf Tauri v2 + Rust & KI-Begleiter für Windows, macOS (Homebrew), Linux & Android.',
    heroTitle: 'KuroCat — Eine tippende schwarze Katze<br />\n          <span>mitten auf deinem Desktop</span>',
    heroSub:
      'Kostenloser, transparenter Open-Source-Desktop-Begleiter mit sofortigem <strong>3D- / 2D-Wechsel</strong> und minimaler GPU-Last. Mit <strong>6 Katzen + BigFish</strong>, Streichel-Schnurren, Passwort-Sichtschutz, OBS-Overlay und <strong>KI-Katzenstudio</strong>.',
    dlTitle: 'Kostenlos laden — In 3 Sekunden auf deinem Desktop',
    dlSub:
      'Jeder Build enthält <strong>stufenlose 20%–150%-Skalierung</strong>, <strong>65%- / 108-Tasten-Wechsel</strong>, <strong>frei wählbare Schweif-Tasten</strong> und <strong>In-App-Auto-Updates</strong>.<br />\n          Schnelles offizielles CDN auf <code>kurocat.org</code> sowie offizielle GitHub Releases mit SHA-256-Prüfung.',
    featTitle: 'Ein Desktop-Haustier, bis ins kleinste Pixel perfektioniert',
    mcpHeadline: 'Teile ein Foto deiner Katze<br />KI modelliert sie in 0,4 Sekunden',
    growthTitle: 'Live-Wachstumskurve',
    faqOfficialQ: 'Was sind die einzige offizielle Website und die echten Download-Quellen für KuroCat?',
    faqOfficialA:
      'KuroCat wird ausschließlich von Qianyi (@qianyiai) entwickelt und gepflegt. Die einzige offizielle Website ist https://kurocat.org/, das offizielle GitHub-Repository ist https://github.com/qianyiai/KuroCat und der offizielle macOS Homebrew Tap ist https://github.com/qianyiai/homebrew-tap. Fremde Domains wie kurocat.net oder inoffizielle Forks stehen in keiner Verbindung zum Autor.',
    footerLinks: {
      download: 'Alle Plattform-Downloads',
      vsBongo: 'KuroCat vs Bongo Cat',
      obs: 'OBS-Transparenz-Guide',
      mcp: 'KI & MCP-Studio',
      security: 'Sicherheitshinweis',
    },
    alert: {
      badge: 'EINZIGE OFFIZIELLE SEITE',
      text: '<strong>kurocat.org</strong> ist die EINZIGE offizielle KuroCat-Website (<code>github.com/qianyiai/KuroCat</code>). ⚠️ WARNUNG: Die Fake-Seite <strong>kurocat.net</strong> verbreitet ein nicht autorisiertes 64-MB-Archiv <code>KuroCat.v5.1.0.zip</code> mit 50 MiB Füll-Müll &amp; einer falschen 36-MB-EXE — NICHT herunterladen oder ausführen!',
      cta: 'Sicherheitshinweis →',
      close: 'Hinweis schließen',
    },
  },
];

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeJsonStr(s) {
  return JSON.stringify(s).slice(1, -1);
}

for (const loc of LOCALE_PAGES) {
  let html = baseHtml;
  html = html.replace(/<html lang="zh-CN">/i, `<html lang="${loc.htmlLang}">`);
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttr(loc.title)}</title>`);
  html = html.replace(
    /<meta name="description" content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${escapeAttr(loc.description)}" />`
  );
  html = html.replace(
    /<link rel="canonical" href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${loc.url}" />`
  );
  html = html.replace(
    /<meta property="og:site_name" content="[^"]*"\s*\/?>/i,
    `<meta property="og:site_name" content="${escapeAttr(loc.siteName)}" />`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*"\s*\/?>/i,
    `<meta property="og:title" content="${escapeAttr(loc.ogTitle)}" />`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*"\s*\/?>/i,
    `<meta property="og:description" content="${escapeAttr(loc.ogDescription)}" />`
  );
  html = html.replace(
    /<meta property="og:url" content="[^"]*"\s*\/?>/i,
    `<meta property="og:url" content="${loc.url}" />`
  );
  html = html.replace(
    new RegExp(`<meta property="og:locale:alternate" content="${loc.ogLocale}"\\s*\\/?>`, 'i'),
    '<meta property="og:locale:alternate" content="zh_CN" />'
  );
  html = html.replace(
    /<meta property="og:locale" content="[^"]*"\s*\/?>/i,
    `<meta property="og:locale" content="${loc.ogLocale}" />`
  );
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:title" content="${escapeAttr(loc.ogTitle)}" />`
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:description" content="${escapeAttr(loc.ogDescription)}" />`
  );

  // Localize dropdown trigger label & active language link
  html = html.replace(
    /<span id="lang-current-label">[^<]*<\/span>/i,
    `<span id="lang-current-label">${escapeAttr(loc.shortLabel)}</span>`
  );
  html = html.replace(
    /<a class="lang-btn active" href="\/" data-lang="zh"/i,
    '<a class="lang-btn" href="/" data-lang="zh"'
  );
  html = html.replace(
    new RegExp(`<a class="lang-btn" href="/${loc.code}/" data-lang="${loc.code}"`, 'i'),
    `<a class="lang-btn active" href="/${loc.code}/" data-lang="${loc.code}"`
  );

  // Localize default whale demo video src, poster, download link & JSON-LD URLs for first-paint HTML
  html = html.replace(/<a\b[^>]*\bid="whale-demo-dl"[^>]*>/i, (tag) =>
    tag.replace(/href="\/media\/whale-douyin-14s\.mp4"/i, `href="/media/whale-douyin-14s-${loc.code}.mp4"`)
  );
  html = html.replace(/<video\b[^>]*\bid="whale-demo-video"[^>]*>/i, (tag) =>
    tag
      .replace(/src="\/media\/whale-douyin-14s\.mp4"/i, `src="/media/whale-douyin-14s-${loc.code}.mp4"`)
      .replace(/poster="\/assets\/whale-douyin-poster\.webp"/i, `poster="/assets/whale-douyin-poster-${loc.code}.webp"`)
  );
  html = html.replace(
    /"thumbnailUrl": "https:\/\/kurocat\.org\/assets\/whale-douyin-poster\.webp"/i,
    `"thumbnailUrl": "https://kurocat.org/assets/whale-douyin-poster-${loc.code}.webp"`
  );
  html = html.replace(
    /"contentUrl": "https:\/\/kurocat\.org\/media\/whale-douyin-14s\.mp4"/i,
    `"contentUrl": "https://kurocat.org/media/whale-douyin-14s-${loc.code}.mp4"`
  );

  // Localize key above-the-fold & section headings for no-JS crawler indexing
  html = html.replace(
    /<h1 class="hero-title" data-i18n-html="hero\.title">[\s\S]*?<\/h1>/i,
    `<h1 class="hero-title" data-i18n-html="hero.title">\n          ${loc.heroTitle}\n        </h1>`
  );
  html = html.replace(
    /<p class="hero-sub" data-i18n-html="hero\.sub">[\s\S]*?<\/p>/i,
    `<p class="hero-sub" data-i18n-html="hero.sub">\n          ${loc.heroSub}\n        </p>`
  );
  html = html.replace(
    /<h2 class="section-title" data-i18n="dl\.title">[\s\S]*?<\/h2>/i,
    `<h2 class="section-title" data-i18n="dl.title">${loc.dlTitle}</h2>`
  );
  html = html.replace(
    /<p class="section-sub" data-i18n-html="dl\.sub">[\s\S]*?<\/p>/i,
    `<p class="section-sub" data-i18n-html="dl.sub">\n          ${loc.dlSub}\n        </p>`
  );
  html = html.replace(
    /<h2 class="section-title" data-i18n="feat\.title">[\s\S]*?<\/h2>/i,
    `<h2 class="section-title" data-i18n="feat.title">${loc.featTitle}</h2>`
  );
  html = html.replace(
    /<h2 class="card-headline" data-i18n-html="mcp\.headline">[\s\S]*?<\/h2>/i,
    `<h2 class="card-headline" data-i18n-html="mcp.headline">${loc.mcpHeadline}</h2>`
  );
  html = html.replace(
    /<h2 class="growth-title" data-i18n="growth\.title">[\s\S]*?<\/h2>/i,
    `<h2 class="growth-title" data-i18n="growth.title">${loc.growthTitle}</h2>`
  );

  // Localize official-website FAQ in JSON-LD
  html = html.replace(
    /"name": "KuroCat 的唯一官方网站与正版下载渠道是什么？",\s*"acceptedAnswer": \{\s*"@type": "Answer",\s*"text": "[^"]*"\s*\}/,
    `"name": "${escapeJsonStr(loc.faqOfficialQ)}",\n            "acceptedAnswer": {\n              "@type": "Answer",\n              "text": "${escapeJsonStr(loc.faqOfficialA)}"\n            }`
  );

  // Localize official alert bar & footer hub links (href + crawler-visible text)
  html = html.replace(
    /data-i18n="alert\.badge">[^<]*<\/span>/g,
    `data-i18n="alert.badge">${escapeAttr(loc.alert.badge)}</span>`
  );
  html = html.replace(
    /data-i18n-html="alert\.text">[\s\S]*?<\/span>/,
    `data-i18n-html="alert.text">${loc.alert.text}</span>`
  );
  html = html.replace(
    /data-i18n="alert\.cta">[^<]*<\/a>/g,
    `data-i18n="alert.cta">${escapeAttr(loc.alert.cta)}</a>`
  );
  html = html.replace(
    /aria-label="关闭公告" title="关闭公告"/g,
    `aria-label="${escapeAttr(loc.alert.close)}" title="${escapeAttr(loc.alert.close)}"`
  );
  html = html.replace(/href="\/download\/"/g, `href="/${loc.code}/download/"`);
  html = html.replace(/href="\/vs\/bongo-cat\/"/g, `href="/${loc.code}/vs/bongo-cat/"`);
  html = html.replace(/href="\/obs\/"/g, `href="/${loc.code}/obs/"`);
  html = html.replace(/href="\/mcp\/"/g, `href="/${loc.code}/mcp/"`);
  html = html.replace(/href="\/security\/"/g, `href="/${loc.code}/security/"`);
  html = html.replace(
    /data-i18n="footer\.download">[^<]*<\/a>/g,
    `data-i18n="footer.download">${escapeAttr(loc.footerLinks.download)}</a>`
  );
  html = html.replace(
    /data-i18n="footer\.vsBongo">[^<]*<\/a>/g,
    `data-i18n="footer.vsBongo">${escapeAttr(loc.footerLinks.vsBongo)}</a>`
  );
  html = html.replace(
    /data-i18n="footer\.obs">[^<]*<\/a>/g,
    `data-i18n="footer.obs">${escapeAttr(loc.footerLinks.obs)}</a>`
  );
  html = html.replace(
    /data-i18n="footer\.mcp">[^<]*<\/a>/g,
    `data-i18n="footer.mcp">${escapeAttr(loc.footerLinks.mcp)}</a>`
  );
  html = html.replace(
    /data-i18n="footer\.security">[^<]*<\/a>/g,
    `data-i18n="footer.security">${escapeAttr(loc.footerLinks.security)}</a>`
  );

  const outDir = path.join(distDir, loc.code);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
}

// Generate 40 localized SEO landing pages (5 topics x 8 locales)
const subpageCount = generateAllSubpages(distDir, today);

// robots.txt
const robotsTxt = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /stats

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: Baiduspider
Allow: /

User-agent: Yeti
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: GPTBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot
Allow: /

Sitemap: https://kurocat.org/sitemap.xml
`;
fs.writeFileSync(path.join(distDir, 'robots.txt'), robotsTxt, 'utf8');

// sitemap.xml (home + 5 topic hubs x 8 locales = 48 localized URLs + llms.txt + llms-full.txt = 50 URLs)
const SITEMAP_LOCALES = [
  { hreflang: 'zh-CN', prefix: '' },
  { hreflang: 'en', prefix: 'en/' },
  { hreflang: 'ja', prefix: 'ja/' },
  { hreflang: 'ko', prefix: 'ko/' },
  { hreflang: 'es', prefix: 'es/' },
  { hreflang: 'pt-BR', prefix: 'pt/' },
  { hreflang: 'ru', prefix: 'ru/' },
  { hreflang: 'de', prefix: 'de/' },
];

function makeHreflangBlock(slugPath) {
  const zhUrl = slugPath ? `https://kurocat.org/${slugPath}/` : 'https://kurocat.org/';
  const lines = [
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${zhUrl}" />`,
    ...SITEMAP_LOCALES.map(({ hreflang, prefix }) => {
      const url = slugPath ? `https://kurocat.org/${prefix}${slugPath}/` : `https://kurocat.org/${prefix}`;
      return `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${url}" />`;
    }),
  ];
  return lines.join('\n');
}

function makeSitemapGroup(slugPath, zhPrio, otherPrio) {
  const hBlock = makeHreflangBlock(slugPath);
  return SITEMAP_LOCALES
    .map(({ prefix }) => {
      const prio = prefix === '' ? zhPrio : otherPrio;
      const locUrl = slugPath ? `https://kurocat.org/${prefix}${slugPath}/` : `https://kurocat.org/${prefix}`;
      return `  <url>
    <loc>${locUrl}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${prio}</priority>
${hBlock}
  </url>`;
    })
    .join('\n');
}

const sitemapEntries = [
  makeSitemapGroup('', '1.0', '0.9'),
  ...SUBPAGE_SLUGS.map((slug) => makeSitemapGroup(slug, slug === 'download' ? '0.9' : '0.8', '0.8')),
].join('\n');

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${sitemapEntries}
  <url>
    <loc>https://kurocat.org/llms.txt</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://kurocat.org/llms-full.txt</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>
`;
fs.writeFileSync(path.join(distDir, 'sitemap.xml'), sitemapXml, 'utf8');

// llms.txt
const llmsTxt = `# KuroCat

> KuroCat is a free, MIT-licensed open-source 3D/2D transparent always-on-top desktop typing cat and AI coding companion built with Tauri v2 and Rust by Qianyi (@qianyiai).

All official downloads, documentation, and source code are published exclusively through Qianyi's official website (\`https://kurocat.org/\`), official GitHub repository (\`https://github.com/qianyiai/KuroCat\`), and official macOS Homebrew Tap (\`https://github.com/qianyiai/homebrew-tap\`). Third-party domains such as \`kurocat.net\` or unofficial forks such as \`chanke17/KuroCat\` are NOT official and are unaffiliated with the author.

## Official Sources

- [KuroCat Official Website & Live 3D Playground (zh-CN)](https://kurocat.org/): Interactive browser 3D/2D playground and fast official CDN downloads.
- [KuroCat Official Website (English)](https://kurocat.org/en/): English interface, downloads, and localized demos.
- [KuroCat Official Website (Japanese / 日本語)](https://kurocat.org/ja/): Japanese interface and demos.
- [KuroCat Official Website (Korean / 한국어)](https://kurocat.org/ko/): Korean interface and demos.
- [KuroCat Official Website (Spanish / Español)](https://kurocat.org/es/): Spanish interface, downloads, and localized demos.
- [KuroCat Official Website (Portuguese BR / Português)](https://kurocat.org/pt/): Brazilian Portuguese interface, downloads, and localized demos.
- [KuroCat Official Website (Russian / Русский)](https://kurocat.org/ru/): Russian interface, downloads, and localized demos.
- [KuroCat Official Website (German / Deutsch)](https://kurocat.org/de/): German interface, downloads, and localized demos.
- [Official All-Platform Downloads & SHA-256 Checksums](https://kurocat.org/download/): Windows 10/11, Win7 Portable, macOS Universal DMG + Homebrew, Linux \`.deb\`/\`.AppImage\`, and Android APK with verified SHA-256 hashes (also at \`/en/download/\`, \`/ja/download/\`, \`/ko/download/\`, \`/es/download/\`, \`/pt/download/\`, \`/ru/download/\`, \`/de/download/\`).
- [KuroCat vs Bongo Cat Comparison](https://kurocat.org/vs/bongo-cat/): Feature, memory/GPU footprint, 3D/2D engine, macOS/Linux support, OBS transparency, and privacy comparison (also at \`/en/vs/bongo-cat/\`, \`/ja/vs/bongo-cat/\`, \`/ko/vs/bongo-cat/\`, \`/es/vs/bongo-cat/\`, \`/pt/vs/bongo-cat/\`, \`/ru/vs/bongo-cat/\`, \`/de/vs/bongo-cat/\`).
- [OBS Transparent Browser Source Guide](https://kurocat.org/obs/): Zero chroma-key local \`http://127.0.0.1:27421/obs\` setup, OBS-Only mode, synced password privacy guard, and \`KuroCat Live\` chroma fallback (also at \`/en/obs/\`, \`/ja/obs/\`, \`/ko/obs/\`, \`/es/obs/\`, \`/pt/obs/\`, \`/ru/obs/\`, \`/de/obs/\`).
- [MCP AI Cat Studio & Coding Companion Guide](https://kurocat.org/mcp/): Built-in Stdio & Streamable HTTP (\`127.0.0.1:27420/mcp\`) setup for Claude Desktop, Cursor, Antigravity, and Windsurf, plus AI cat sculpting prompts (also at \`/en/mcp/\`, \`/ja/mcp/\`, \`/ko/mcp/\`, \`/es/mcp/\`, \`/pt/mcp/\`, \`/ru/mcp/\`, \`/de/mcp/\`).
- [Official Security Advisory — Fake Site kurocat.net Warning](https://kurocat.org/security/): Forensic evidence and IoCs warning users NOT to download the unauthorized 64.25 MB padded ZIP (\`KuroCat.v5.1.0.zip\`, SHA-256 \`19ad10c48a7448584f1d00aa086f52b38231bacd659f04e83d3cefc60209796d\`) hosted by impersonator \`kurocat.net\` (also at \`/en/security/\`, \`/ja/security/\`, \`/ko/security/\`, \`/es/security/\`, \`/pt/security/\`, \`/ru/security/\`, \`/de/security/\`).
- [Official GitHub Repository](https://github.com/qianyiai/KuroCat): MIT open-source codebase, issue tracker, and GitHub Releases.
- [Official macOS Homebrew Tap](https://github.com/qianyiai/homebrew-tap): Install on macOS via \`brew install --cask qianyiai/tap/kurocat\`.
- [Author Homepage (Qianyi)](https://qianyi.one/): Author profile and projects.
- [Full Technical Reference](https://kurocat.org/llms-full.txt): Complete architecture, platform support, AI companion hooks, MCP tools, and direct release URLs.

## Supported Platforms (Latest: v5.1.3)

- Windows 10 / 11 (x64 NSIS Installer, ~2.40 MB): \`https://kurocat.org/releases/v5.1.3/KuroCat-5.1.3-x64-setup.exe\`
- Windows 7 SP1 (x64 Portable with offline WebView2 109): \`https://kurocat.org/releases/v5.1.3/KuroCat-v5.1.3-win7-x64-portable.zip\`
- macOS 10.15 Catalina+ (Apple Silicon M1–M4 & Intel Universal DMG): \`https://kurocat.org/releases/v5.1.3/KuroCat-v5.1.3-macos-universal.dmg\` or \`brew install --cask qianyiai/tap/kurocat\`
- Linux (Ubuntu 22.04+, Debian 12+, KylinOS V11+ — x86_64 & ARM64 \`.deb\` / \`.AppImage\`): \`https://kurocat.org/#linux-download\`
- Android APK: \`https://kurocat.org/releases/v5.1.3/KuroCat-v5.1.3-android.apk\`
`;
fs.writeFileSync(path.join(distDir, 'llms.txt'), llmsTxt, 'utf8');

// llms-full.txt
const llmsFullTxt = `# KuroCat — Complete Technical & Official Source Reference

> Official Website: https://kurocat.org/
> Official GitHub Repository: https://github.com/qianyiai/KuroCat
> Official Homebrew Tap: https://github.com/qianyiai/homebrew-tap
> Author: Qianyi (谦一) — https://qianyi.one/ · https://github.com/qianyiai
> License: MIT (Free & Open Source)

## Official Provenance Statement

KuroCat is developed and maintained exclusively by Qianyi (\`@qianyiai\`). The ONLY official distribution channels are:
1. Official Website: https://kurocat.org/ (Multilingual: https://kurocat.org/en/ , https://kurocat.org/ja/ , https://kurocat.org/ko/ , https://kurocat.org/es/ , https://kurocat.org/pt/ , https://kurocat.org/ru/ , https://kurocat.org/de/ )
2. GitHub Releases & Source Code: https://github.com/qianyiai/KuroCat
3. Official macOS Homebrew Tap: https://github.com/qianyiai/homebrew-tap (\`brew install --cask qianyiai/tap/kurocat\`)

Any third-party domain claiming to be an official site or mirror (including \`kurocat.net\`) or unofficial forks (such as \`chanke17/KuroCat\`) are unaffiliated with the author and not officially maintained. Legacy URL \`https://qianyi.one/kurocat/\` permanently redirects (HTTP 301) to \`https://kurocat.org/\`.

## Overview

KuroCat is a lightweight, transparent, always-on-top desktop typing cat and AI coding companion built with **Tauri v2** and **Rust**. Designed as a modern, open-source, ultra-low-resource alternative to Bongo Cat, it reacts in real time to global keyboard, mouse, and AI coding assistant events without stealing window focus or slowing down games.

## Core Features (v5.1.3)

- **3D Figurine & 2D Classic Dual Engine**: Instant switching between a 3D volumetric model (GPU-batched keycap atlas & vertex deformation, ~75% lower active GPU load, automatic 30 FPS game power-saving mode) and classic 2D hand-drawn art.
- **7 Built-In Characters**: Classic Black Cat, Warm Milk-Tea Ragdoll, Orange Tabby, Calico, Tuxedo, Siamese, and BigFish (whale-girl with three-way mouse + typing + tail action and cursor gaze tracking).
- **65% Compact & 108-Key Full-Size Keyboards**: Real key mapping including independent main Enter vs Numpad Enter, cat-facing (180°) and viewer-facing perspectives, plus customizable tail-key patting (Smart Third Hand, Custom Key Picker, Edge Keys, Wag Only).
- **Independent Mouse L/R/M Highlights**: Distinct colors for Left, Right, and Middle/Scroll clicks, simultaneous dual-button press support, and optional floating key bubbles.
- **Tactile & Emotional Interactions**: Head-petting with real recorded cat purring & optional typing sound effects, Edge-Peek hiding, rapid-mouse curiosity eyes, sleep/wake-up anger reactions, and optional 3D collar bell & auto-gaming headphones.
- **OS-Level Password Privacy Guard**: Automatically detects Windows, macOS, and Android password/fintech input fields so the cat gently closes its eyes (BigFish covers its eyes with both hands) while masking keycaps and key bubbles and never transmitting keystroke content.
- **AI Coding Companion Integration**: Live emotional & typing feedback for Claude Code, Codex CLI, Cursor, Windsurf, DeepSeek, and Doubao via \`--hook\`, local HTTP \`/hook\` & \`/agent/event\`, and Streamable HTTP \`/mcp\` — synced to OBS transparent overlays.
- **Built-In MCP Studio (10 Tools)**: Stdio and local Streamable HTTP (\`http://127.0.0.1:27420/mcp\`) server with zero Node.js/Python dependencies required; customize cat fur, 16-spot markings, 22 2D/3D facial sculpting parameters (folded/floppy ears, heterochromia, blep, eyebrows), and hot-reload in 0.4s.
- **Native OBS Transparent Overlay & KuroCat Live**: Local \`http://127.0.0.1:27421/obs\` Browser Source with true Alpha transparency (no chroma key), optional OBS-Only mode, synchronized privacy masking, plus dedicated \`KuroCat Live\` blue/green/magenta chroma capture window.
- **Desktop Ergonomics**: 20%–100% pet opacity, 20%–150% smooth scaling, persistent click-through lock (\`Alt\` temporary drag), RDP topmost yielding, single-instance guard, anti-cheat pause/hide mode, and SHA-256 verified in-app auto-updater.

## Dedicated Multilingual Topic Hubs

Every topic hub is pre-rendered in Chinese (\`zh-CN\`), English (\`/en/\`), Japanese (\`/ja/\`), Korean (\`/ko/\`), Spanish (\`/es/\`), Brazilian Portuguese (\`/pt/\`), Russian (\`/ru/\`), and German (\`/de/\`) with bidirectional \`hreflang\` and structured data:
- **Official Downloads & SHA-256 Verification**: https://kurocat.org/download/ · https://kurocat.org/en/download/ · https://kurocat.org/ja/download/ · https://kurocat.org/ko/download/ · https://kurocat.org/es/download/ · https://kurocat.org/pt/download/ · https://kurocat.org/ru/download/ · https://kurocat.org/de/download/
- **KuroCat vs Bongo Cat Comparison**: https://kurocat.org/vs/bongo-cat/ · https://kurocat.org/en/vs/bongo-cat/ · https://kurocat.org/ja/vs/bongo-cat/ · https://kurocat.org/ko/vs/bongo-cat/ · https://kurocat.org/es/vs/bongo-cat/ · https://kurocat.org/pt/vs/bongo-cat/ · https://kurocat.org/ru/vs/bongo-cat/ · https://kurocat.org/de/vs/bongo-cat/
- **OBS Zero Chroma-Key Overlay Guide**: https://kurocat.org/obs/ · https://kurocat.org/en/obs/ · https://kurocat.org/ja/obs/ · https://kurocat.org/ko/obs/ · https://kurocat.org/es/obs/ · https://kurocat.org/pt/obs/ · https://kurocat.org/ru/obs/ · https://kurocat.org/de/obs/
- **MCP AI Cat Studio & Coding Companion**: https://kurocat.org/mcp/ · https://kurocat.org/en/mcp/ · https://kurocat.org/ja/mcp/ · https://kurocat.org/ko/mcp/ · https://kurocat.org/es/mcp/ · https://kurocat.org/pt/mcp/ · https://kurocat.org/ru/mcp/ · https://kurocat.org/de/mcp/
- **Official Security Advisory (Fake \`kurocat.net\` Malware Warning)**: https://kurocat.org/security/ · https://kurocat.org/en/security/ · https://kurocat.org/ja/security/ · https://kurocat.org/ko/security/ · https://kurocat.org/es/security/ · https://kurocat.org/pt/security/ · https://kurocat.org/ru/security/ · https://kurocat.org/de/security/ — WARNING: \`kurocat.net\` is an unauthorized impersonation site distributing a padded 64.25 MB \`KuroCat.v5.1.0.zip\` (SHA-256 \`19ad10c48a7448584f1d00aa086f52b38231bacd659f04e83d3cefc60209796d\`) containing an unknown 35.92 MB executable plus 50 MiB of uncompressed junk padding (\`resources.pak\` / \`versions.dat\`). Official Windows 10/11 installers are only ~2.40 MB.

## Direct Official Downloads (v5.1.3)

- Windows 10/11 (x64 Installer): https://kurocat.org/releases/v5.1.3/KuroCat-5.1.3-x64-setup.exe
- Windows 7 SP1 (x64 Portable w/ WebView2 109): https://kurocat.org/releases/v5.1.3/KuroCat-v5.1.3-win7-x64-portable.zip
- macOS 10.15+ Universal (Apple Silicon & Intel DMG): https://kurocat.org/releases/v5.1.3/KuroCat-v5.1.3-macos-universal.dmg
- macOS Homebrew Cask: \`brew install --cask qianyiai/tap/kurocat\`
- Linux x86_64 \`.deb\`: https://kurocat.org/releases/v5.1.3/KuroCat-v5.1.3-linux-amd64.deb
- Linux ARM64 \`.deb\`: https://kurocat.org/releases/v5.1.3/KuroCat-v5.1.3-linux-arm64.deb
- Linux x86_64 \`.AppImage\`: https://kurocat.org/releases/v5.1.3/KuroCat-v5.1.3-linux-amd64.AppImage
- Linux ARM64 \`.AppImage\`: https://kurocat.org/releases/v5.1.3/KuroCat-v5.1.3-linux-arm64.AppImage
- Android APK: https://kurocat.org/releases/v5.1.3/KuroCat-v5.1.3-android.apk
- GitHub Releases (all platforms): https://github.com/qianyiai/KuroCat/releases

## Localized Demo Media

- 3D Sleep → Wake-Up → Head-Pat Purr (9s MP4):
  - ZH: https://kurocat.org/media/wake-pet-9s.mp4
  - EN: https://kurocat.org/media/wake-pet-9s-en.mp4
  - JA: https://kurocat.org/media/wake-pet-9s-ja.mp4
  - KO: https://kurocat.org/media/wake-pet-9s-ko.mp4
- BigFish Whale-Girl Demo (14s 1080×1920 60fps MP4):
  - ZH: https://kurocat.org/media/whale-douyin-14s.mp4
  - EN: https://kurocat.org/media/whale-douyin-14s-en.mp4
  - JA: https://kurocat.org/media/whale-douyin-14s-ja.mp4
  - KO: https://kurocat.org/media/whale-douyin-14s-ko.mp4
  - ES: https://kurocat.org/media/whale-douyin-14s-es.mp4
  - PT: https://kurocat.org/media/whale-douyin-14s-pt.mp4
  - RU: https://kurocat.org/media/whale-douyin-14s-ru.mp4
  - DE: https://kurocat.org/media/whale-douyin-14s-de.mp4
`;
fs.writeFileSync(path.join(distDir, 'llms-full.txt'), llmsFullTxt, 'utf8');

// IndexNow key file
fs.writeFileSync(path.join(distDir, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY, 'utf8');

console.log(`[postbuild-kurocat-seo] Generated /en/, /ja/, /ko/, /es/, /pt/, /ru/, /de/, ${subpageCount} localized SEO subpages, robots.txt, sitemap.xml, llms.txt, llms-full.txt & IndexNow key.`);

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.argv[2], 'playwright'));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
  const pages = () => browser.contexts().flatMap(context => context.pages());
  const desktop = pages().find(page => page.url() === 'http://tauri.localhost/');
  assert.ok(desktop, 'isolated desktop must be present');
  await desktop.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const rid = await invoke('plugin:tray|get_by_id', { id: 'kuro-tray' });
    await invoke('plugin:tray|set_tooltip', { rid, tooltip: 'KuroCat 测试版（紧凑菜单验收）' });
    await invoke('open_context_menu');
  });
  let menu;
  for (let attempt = 0; attempt < 100; attempt++) {
    menu = pages().find(page => new URL(page.url()).pathname === '/menu.html');
    if (menu) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(menu, 'native settings menu must open');
  await menu.locator('.character-menu .breed-pill').first().waitFor();
  const metrics = await menu.evaluate(() => {
    const catHeight = document.querySelector('#breed-pills .breed-pill').getBoundingClientRect().height;
    const list = document.querySelector('.character-menu .breed-pills');
    return {
      catHeight,
      headings: ['#breed-pills', '.character-menu .breed-pills'].map(selector => {
        const heading=document.querySelector(selector).parentElement.querySelector('.menu-scale-label');
        const style=getComputedStyle(heading);
        return {fontSize:style.fontSize,color:style.color,fontWeight:style.fontWeight,lineHeight:style.lineHeight};
      }),
      buttons: [...list.querySelectorAll('.breed-pill')].map(button => ({
        height: button.getBoundingClientRect().height,
        whiteSpace: getComputedStyle(button).whiteSpace,
        textOverflow: getComputedStyle(button).textOverflow,
        title: button.title,
      })),
      scrollbarWidth: getComputedStyle(list, '::-webkit-scrollbar').width,
      scrollbarButtons: getComputedStyle(list, '::-webkit-scrollbar-button').display,
    };
  });
  fs.writeFileSync('tmp/native-validation/compact-menu-native-metrics.json', JSON.stringify(metrics, null, 2));
  assert.deepEqual(metrics.headings[0],metrics.headings[1]);
  assert.ok(metrics.buttons.length > 0);
  for (const button of metrics.buttons) {
    assert.ok(Math.abs(button.height - metrics.catHeight) < 1);
    assert.equal(button.whiteSpace, 'nowrap');
    assert.equal(button.textOverflow, 'ellipsis');
    assert.ok(button.title.includes('ID:'));
  }
  assert.equal(metrics.scrollbarWidth, '5px');
  assert.equal(metrics.scrollbarButtons, 'none');
  await menu.screenshot({ path: 'tmp/native-validation/compact-menu-native.png' });
  fs.writeFileSync('tmp/native-validation/compact-menu-native-report.json', JSON.stringify({ passed: true, metrics, selectionChanged: false }, null, 2));
  console.log(JSON.stringify({ passed: true, catHeight: metrics.catHeight, characterButtons: metrics.buttons.length }));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const ts=require(path.join(process.argv[3],'typescript'));
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[];
  try {
    fs.mkdirSync('tmp/character-menu',{recursive:true});
    const page=await browser.newPage({viewport:{width:580,height:1000}});
    // Other work in this shared workspace can trigger Vite full reloads mid-scenario.
    // Freeze this test's loaded modules; application events still use the real menu listeners.
    await page.route('**/@vite/client',route=>route.fulfill({contentType:'text/javascript',body:`
      const styles=new Map();
      export function createHotContext(){return {accept(){},prune(){},dispose(){}};}
      export function updateStyle(id,css){let style=styles.get(id);if(!style){style=document.createElement('style');styles.set(id,style);document.head.append(style);}style.textContent=css;}
      export function removeStyle(id){styles.get(id)?.remove();styles.delete(id);}
      export const injectQuery=url=>url;
      export class ErrorOverlay extends HTMLElement {}
    `}));
    page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});page.on('console',message=>{if(message.type()==='error'){errors.push(message.text());console.error(message.text());}});
    // Native IPC and dev-server HMR are replaced; real menu HTML, CSS, menuMain and characterMenu execute.
    const source=ts.transpileModule(fs.readFileSync('src/menuMain.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
      .replace(/(['"])@tauri-apps\/api\/(?:core|event)\1/g,'"/__menu-test-api.js"')
      .replace(/(['"])\.\/([^'"]+)\1/g,(_m,q,name)=>`${q}/src/${name}${path.extname(name)?'':'.ts'}${q}`);
    await page.route('**/src/menuMain.ts*',route=>route.fulfill({contentType:'text/javascript',body:source}));
    await page.route('**/__menu-test-api.js',route=>route.fulfill({contentType:'text/javascript',body:'export const invoke=(...args)=>window.menuMock.invoke(...args); export const listen=(...args)=>window.menuMock.listen(...args);'}));
    await page.addInitScript(()=>{
      const callbacks=new Map();
      const mock=window.menuMock={settings:{activeCharacterId:'motion-fixture',characterOutfits:{'motion-fixture':'alternate'},catBreed:'black',scale:1,renderMode:'3d',tailKeyMode:'smart',tailKeyIds:[],soundEnabled:true,showKeyBubbles:true},
        catalog:{characters:[{entry:{id:'motion-fixture',name:'测试夹具',outfits:['primary','alternate','legacy'],playableOutfits:['primary','alternate']}}]},failSwitch:false,deferCatalog:false,
        listen:async(name,handler)=>{if(!callbacks.has(name))callbacks.set(name,[]);callbacks.get(name).push(handler);return()=>{};},
        emit:(name,payload=mock.settings)=>{for(const callback of callbacks.get(name)??[])callback({payload:structuredClone(payload)});},
        invoke:async(command,args)=>{
          if(command==='get_settings')return structuredClone(mock.settings);
          if(command==='get_character_list'){
            if(mock.failCatalog)throw new Error('INVALID_REGISTRY: repair or reimport');
            if(mock.deferCatalog){mock.deferCatalog=false;return new Promise((_resolve,reject)=>{mock.rejectCatalog=reject;});}
            return structuredClone(mock.catalog);
          }
          if(command==='get_cats')return [{id:'black',name:'小黑猫',emoji:'🐈‍⬛',builtin:true}];
          if(command==='get_app_version'){await new Promise(resolve=>setTimeout(resolve,100));return 'test';}
          if(command==='is_win7_ulw_mode'){mock.booted=true;return false;}
          if(command==='switch_character'){
            if(mock.failSwitch)throw new Error('IMPORT_BUSY: retry selection');
            mock.settings.activeCharacterId=args.id;mock.settings.characterOutfits[args.id]=args.outfitId;
            mock.emit('kuro-settings');return {};
          }
          if(command==='update_settings'){
            Object.assign(mock.settings,args.patch);
            if(Object.hasOwn(args.patch,'catBreed'))mock.settings.activeCharacterId=null;
            mock.emit('kuro-settings');return structuredClone(mock.settings);
          }
          throw new Error('Unexpected command: '+command);
        }};
    });
    await page.goto('http://127.0.0.1:1422/menu.html');await page.waitForFunction(()=>window.menuMock.booted);
    const headingStyles=await page.evaluate(()=>{
      const imported=document.querySelector('.character-menu .menu-scale-label');
      const original=document.querySelector('#breed-pills').parentElement.querySelector('.menu-scale-label');
      const style=element=>{const s=getComputedStyle(element);return {fontSize:s.fontSize,color:s.color,fontWeight:s.fontWeight,lineHeight:s.lineHeight};};
      return {imported:style(imported),original:style(original)};
    });
    assert.deepEqual(headingStyles.imported,headingStyles.original,'character heading matches the existing appearance heading');

    assert.match(await page.locator('#menu-header').innerText(),/测试夹具.*alternate/);
    assert.equal(await page.locator('.character-menu .active').innerText(),'测试夹具 · alternate');
    assert.equal(await page.getByRole('button',{name:'测试夹具 · legacy',exact:true}).isDisabled(),true);
    checks.push('production standalone menu keeps character/outfit title after bootstrap and disables frame-only outfit');
    await page.getByRole('button',{name:'测试夹具 · primary',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.character-menu .active')?.textContent==='测试夹具 · primary');
    assert.match(await page.locator('#menu-header').innerText(),/测试夹具.*primary/);
    assert.equal(await page.locator('[data-rendermode="2d"]').evaluate(el=>el.classList.contains('active')),true);
    checks.push('outfit switching shows actual 2D mode and matching selection');
    await page.screenshot({path:'tmp/character-menu/character-selected.png'});
    await page.evaluate(()=>window.menuMock.failSwitch=true);
    await page.getByRole('button',{name:'测试夹具 · alternate',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.character-menu-status').textContent.includes('IMPORT_BUSY'));
    assert.equal(await page.locator('.character-menu .active').innerText(),'测试夹具 · primary');checks.push('failed selection retains actual choice and visible error');
    await page.evaluate(()=>{window.menuMock.failSwitch=false;window.menuMock.emit('kuro-settings');});
    await page.waitForFunction(()=>document.querySelector('.character-menu-status').textContent==='');
    await page.evaluate(()=>{window.menuMock.deferCatalog=true;window.menuMock.emit('kuro-characters');});
    await page.waitForFunction(()=>!!window.menuMock.rejectCatalog);
    await page.evaluate(()=>window.menuMock.emit('kuro-characters'));
    await page.waitForFunction(()=>document.querySelector('.character-menu-status').textContent==='');
    await page.evaluate(async()=>{window.menuMock.rejectCatalog(new Error('old failed catalog'));await new Promise(requestAnimationFrame);});
    assert.equal(await page.locator('.character-menu-status').innerText(),'');checks.push('late failed refresh cannot overwrite a newer successful menu');
    await page.evaluate(()=>{window.menuMock.catalog.characters=[];window.menuMock.emit('kuro-characters');});
    await page.waitForFunction(()=>document.querySelector('.character-menu-status').textContent.includes('不可用'));
    assert.equal(await page.locator('.character-menu').isVisible(),true);checks.push('missing active package remains visible with recovery guidance');
    await page.locator('[data-breed="black"]').click();
    await page.waitForFunction(()=>!window.menuMock.settings.activeCharacterId&&document.querySelector('.character-menu').hidden)
      .catch(async error=>{console.error(await page.evaluate(()=>({settings:window.menuMock.settings,status:document.querySelector('.character-menu-status')?.textContent})));throw error;});
    assert.match(await page.locator('#menu-header').innerText(),/小黑猫/);
    assert.equal(await page.locator('[data-rendermode="3d"]').isDisabled(),false);checks.push('legacy cat selection exits character mode and restores controls');
    await page.evaluate(()=>{window.menuMock.failCatalog=true;window.menuMock.emit('kuro-menu-opened');});
    await page.waitForFunction(()=>document.querySelector('.character-menu-status').textContent.includes('INVALID_REGISTRY'));
    assert.equal(await page.locator('.character-menu').isVisible(),true);
    await page.evaluate(()=>{window.menuMock.failCatalog=false;window.menuMock.emit('kuro-menu-opened');});
    await page.waitForFunction(()=>document.querySelector('.character-menu').hidden&&document.querySelector('.character-menu-status').textContent==='');
    checks.push('reopening the menu retries a failed catalog and clears a recovered error');
    await page.evaluate(()=>{
      const mock=window.menuMock;
      mock.catalog.characters=['motion-fixture','second-copy'].map(id=>({entry:{id,name:'测试夹具',outfits:['primary'],playableOutfits:['primary']}}));
      mock.settings.activeCharacterId='motion-fixture';mock.settings.characterOutfits['motion-fixture']='primary';mock.emit('kuro-settings');
    });
    await page.waitForFunction(()=>document.querySelectorAll('[data-character-id]').length===2);
    assert.match(await page.locator('[data-character-id="motion-fixture"]').innerText(),/motion-fixture/);
    assert.match(await page.locator('[data-character-id="second-copy"]').innerText(),/second-copy/);
    checks.push('duplicate display names remain distinguishable by character ID');
    await page.locator('[data-tab="system"]').click();
    assert.equal(await page.locator('[data-tab-panel="system"]').isVisible(),true);
    assert.equal(await page.locator('.character-menu').isVisible(),false);
    await page.locator('[data-tab="appearance"]').click();
    assert.equal(await page.locator('.character-menu').isVisible(),true);
    assert.equal(await page.locator('[data-character-id="motion-fixture"]').getAttribute('aria-pressed'),'true');
    checks.push('upstream two-tab menu preserves the selected character and restores its visible outfit controls');
    await page.evaluate(()=>window.menuMock.emit('kuro-character-selection-error','人物切换失败（INVALID_PNG）：资源损坏；保留原选择，请重试或重新导入。'));
    await page.waitForFunction(()=>document.querySelector('.character-menu-status').textContent.includes('INVALID_PNG'));
    assert.equal(await page.locator('[data-character-id="motion-fixture"]').getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>window.menuMock.emit('kuro-menu-opened'));
    await page.waitForFunction(()=>document.querySelector('.character-menu-status').textContent.includes('INVALID_PNG'));
    checks.push('tray selection error is visible after reopening and preserves the actual selected outfit');
    await page.getByRole('button',{name:'测试夹具 (second-copy) · primary',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.character-menu-status').textContent===''&&document.querySelector('[data-character-id="second-copy"]').getAttribute('aria-pressed')==='true');
    checks.push('successful menu recovery clears the previous tray error');
    await page.evaluate(()=>window.menuMock.emit('kuro-character-selection-error','人物切换失败（IMPORT_BUSY）：重试。'));
    await page.waitForFunction(()=>document.querySelector('.character-menu-status').textContent.includes('IMPORT_BUSY'));
    await page.evaluate(()=>window.menuMock.emit('kuro-character-selection-error',''));
    await page.waitForFunction(()=>document.querySelector('.character-menu-status').textContent==='');
    checks.push('successful tray selection event clears its previous error');
    await page.evaluate(()=>{
      const mock=window.menuMock;
      const outfits=Array.from({length:14},(_,i)=>`long-outfit-for-compact-${i}`);
      mock.catalog.characters=[{entry:{id:'motion-fixture',name:'大肥鱼测试夹具 · 很长的人物显示名称',outfits,playableOutfits:outfits}}];
      mock.emit('kuro-characters');
    });
    await page.waitForFunction(()=>document.querySelectorAll('[data-character-id]').length===14);
    for(const width of [260,360]){
      await page.setViewportSize({width,height:1000});
      const compact=await page.evaluate(()=>{
        const list=document.querySelector('.character-menu .breed-pills');
        const cat=document.querySelector('#breed-pills .breed-pill');
        const buttons=[...list.querySelectorAll('.breed-pill')];
        return {catHeight:cat.getBoundingClientRect().height,heights:buttons.map(b=>b.getBoundingClientRect().height),
          whiteSpace:getComputedStyle(buttons[0]).whiteSpace,ellipsis:getComputedStyle(buttons[0]).textOverflow,title:buttons[0].title,
          width:list.clientWidth,scrollHeight:list.scrollHeight,height:list.clientHeight,
          barWidth:getComputedStyle(list,'::-webkit-scrollbar').width,track:getComputedStyle(list,'::-webkit-scrollbar-track').backgroundColor,
          arrows:getComputedStyle(list,'::-webkit-scrollbar-button').display};
      });
      assert.ok(compact.heights.every(height=>Math.abs(height-compact.catHeight)<1),'all imported choices match cat button height');
      assert.equal(compact.whiteSpace,'nowrap');assert.equal(compact.ellipsis,'ellipsis');
      assert.match(compact.title,/很长的人物显示名称.*long-outfit/);assert.match(compact.title,/motion-fixture/);
      assert.ok(compact.scrollHeight>compact.height);assert.equal(compact.barWidth,'5px');
      assert.equal(compact.track,'rgba(0, 0, 0, 0)');assert.equal(compact.arrows,'none');
      await page.locator('.character-menu .breed-pills').evaluate(list=>{list.scrollTop=list.scrollHeight;});
      assert.ok(await page.locator('.character-menu .breed-pills').evaluate(list=>list.scrollTop>0));
    }
    await page.locator('.character-menu .breed-pills').evaluate(list=>{list.scrollTop=0;});
    await page.screenshot({path:'tmp/character-menu/compact-characters.png'});
    checks.push('long character labels keep cat button height, expose full tooltip and scroll in a dark slim gutter at narrow widths');
    await page.screenshot({path:'tmp/character-menu/legacy-restored.png'});
    assert.deepEqual(errors,[]);
    fs.writeFileSync('tmp/character-menu/report.json',JSON.stringify({checks,errors,nativeIpcTested:false},null,2));
    console.log(JSON.stringify({passed:checks.length,errors}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

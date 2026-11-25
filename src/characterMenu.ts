type Rpc = <T>(command: string, args?: Record<string,unknown>) => Promise<T>;
interface CatalogEntry { id:string; name:string; outfits:string[]; playableOutfits?:string[] }
interface Catalog { characters: Array<{ entry: CatalogEntry }> }
export function installCharacterMenu(rpc: Rpc, subscribe: (event:string, handler:(event:{payload?:unknown})=>void)=>Promise<unknown>): void {
  const host=document.getElementById('breed-pills')?.parentElement;
  if(!host) return;
  const group=document.createElement('div');group.className='menu-scale-row character-menu';
  const title=document.createElement('div');title.className='menu-scale-label';title.textContent='导入人物 · 2D';group.append(title);
  const rows=document.createElement('div');rows.className='breed-pills';group.append(rows);
  const status=document.createElement('div');status.className='character-menu-status';group.append(status);
  status.setAttribute('role','status');
  host.after(group);
  let generation=0;
  let trayError='';
  const previousDisabled=new Map<HTMLButtonElement,boolean>();
  const refresh=async(actionError='')=>{
    const token=++generation;
    try {
      const [catalog,settings]=await Promise.all([rpc<Catalog>('get_character_list'),rpc<{activeCharacterId?:string;characterOutfits?:Record<string,string>}>('get_settings')]);
      if(token!==generation) return;
      rows.replaceChildren();group.hidden=!catalog.characters.length&&!settings.activeCharacterId&&!actionError&&!trayError;
      const controls=document.querySelectorAll<HTMLButtonElement>('[data-rendermode],[data-collar],[data-headphonemode],[data-tailmode],[data-action="open-tail-picker"]');
      for(const control of controls) {
        if(settings.activeCharacterId){if(!previousDisabled.has(control))previousDisabled.set(control,control.disabled);control.disabled=true;}
        else if(previousDisabled.has(control)){control.disabled=previousDisabled.get(control)!;previousDisabled.delete(control);}
      }
      const selected=catalog.characters.find(c=>c.entry.id===settings.activeCharacterId);
      const displayName=(entry:CatalogEntry)=>catalog.characters.filter(item=>item.entry.name===entry.name).length>1
        ?`${entry.name} (${entry.id})`:entry.name;
      const missing=settings.activeCharacterId&&!selected;
      status.textContent=actionError||trayError||(missing?'当前人物不可用，请重新导入或选择猫咪。':'');
      const header=document.getElementById('menu-header');
      if(settings.activeCharacterId&&header){
        header.textContent=selected?`${displayName(selected.entry)} · ${settings.characterOutfits?.[selected.entry.id]??'默认服装'} · 2D`:'人物不可用 · 2D';
        header.style.color='';
      }
      for(const {entry} of catalog.characters) for(const outfitId of entry.outfits){
        const button=document.createElement('button');button.type='button';button.className='breed-pill';
        button.textContent=`${displayName(entry)} · ${outfitId}`;
        button.dataset.characterId=entry.id;button.dataset.outfitId=outfitId;
        button.title=`${entry.name} · ${outfitId}\nID: ${entry.id}`;
        button.disabled=!entry.playableOutfits?.includes(outfitId);
        button.classList.toggle('active',settings.activeCharacterId===entry.id&&settings.characterOutfits?.[entry.id]===outfitId);
        button.setAttribute('aria-pressed',String(button.classList.contains('active')));
        button.addEventListener('click',async()=>{
          button.disabled=true;
          let errorMessage='';
          try { await rpc('switch_character',{id:entry.id,outfitId}); trayError=''; }
          catch(error){errorMessage=String(error);}
          finally {void refresh(errorMessage);}
        });
        rows.append(button);
      }
    } catch(error){if(token===generation){group.hidden=false;status.textContent=String(error);}}
  };
  for(const event of ['kuro-characters','kuro-settings','kuro-menu-opened']) {
    void subscribe(event,()=>void refresh()).catch(error=>{group.hidden=false;status.textContent=String(error);});
  }
  void subscribe('kuro-character-selection-error',event=>{
    if(typeof event.payload!=='string')return;
    trayError=event.payload;
    void refresh();
  }).catch(error=>{group.hidden=false;status.textContent=String(error);});
  void refresh();
}

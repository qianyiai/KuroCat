// Creates only a fresh portable test profile/collection. Never reads existing OBS user data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve('tmp/native-validation/obs-portable-33.0.3');
if(!fs.existsSync(path.join(root,'portable_mode.txt')))throw new Error('Verified portable OBS is not prepared');
const config=path.join(root,'config/obs-studio');
const profile=path.join(config,'basic/profiles/KuroCatValidation');
const scenes=path.join(config,'basic/scenes');
for(const directory of [profile,scenes])fs.mkdirSync(directory,{recursive:true});
const write=(file,value)=>fs.writeFileSync(file,value,{flag:'wx'});
const common='[General]\nFirstRun=true\n\n[Basic]\nProfile=KuroCat Validation\nProfileDir=KuroCatValidation\nSceneCollection=KuroCat Validation\nSceneCollectionFile=KuroCatValidation\nConfigOnNewProfile=false\n\n[BasicWindow]\nPreviewEnabled=true\nPreviewProgramMode=false\n';
write(path.join(config,'global.ini'),common);write(path.join(config,'user.ini'),common);
write(path.join(profile,'basic.ini'),'[General]\nName=KuroCat Validation\n\n[Video]\nBaseCX=540\nBaseCY=456\nOutputCX=540\nOutputCY=456\nFPSType=0\nFPSCommon=30\n\n[Audio]\nSampleRate=48000\nChannelSetup=Stereo\n\n[Output]\nMode=Simple\n');
const browserId=crypto.randomUUID(),backgroundId=crypto.randomUUID(),sceneId=crypto.randomUUID();
const source=(name,id,uuid,settings)=>({name,id,versioned_id:id,uuid,settings,mixers:0,volume:0,enabled:true,muted:true,flags:0,sync:0});
const item=(name,uuid,id)=>({name,source_uuid:uuid,id,visible:true,locked:false,rot:0,align:5,
  pos:{x:0,y:0},scale:{x:1,y:1},bounds_type:0,bounds_align:0,bounds:{x:0,y:0},scale_filter:'disable',blend_method:'default',blend_type:'normal'});
const collection={name:'KuroCat Validation',current_scene:'KuroCat Validation',current_program_scene:'KuroCat Validation',
  scene_order:[{name:'KuroCat Validation'}],groups:[],
  DesktopAudioDevice1:null,DesktopAudioDevice2:null,AuxAudioDevice1:null,AuxAudioDevice2:null,AuxAudioDevice3:null,AuxAudioDevice4:null,
  sources:[source('Transparency background','color_source_v3',backgroundId,{width:540,height:456,color:0xff584024}),
    source('KuroCat Browser','browser_source',browserId,{url:'http://127.0.0.1:37421/obs.html?mode=2d',width:540,height:456,
      fps:30,fps_custom:true,shutdown:false,restart_when_active:true,reroute_audio:false,
      css:'body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }'}),
    source('KuroCat Validation','scene',sceneId,{items:[item('Transparency background',backgroundId,1),item('KuroCat Browser',browserId,2)],id_counter:2})],
  transitions:[{name:'Cut',id:'cut_transition',settings:{}}],current_transition:'Cut',transition_duration:300,
  quick_transitions:[],saved_projectors:[],preview_locked:false,scaling_enabled:false,scaling_level:0,scaling_off_x:0,scaling_off_y:0};
write(path.join(scenes,'KuroCatValidation.json'),JSON.stringify(collection,null,2));
fs.writeFileSync('tmp/native-validation/obs-profile.json',JSON.stringify({root,config,profile,sceneCollection:path.join(scenes,'KuroCatValidation.json'),url:'http://127.0.0.1:37421/obs.html?mode=2d',onlyBrowserAndColorSource:true,audioCaptureSources:false},null,2));
console.log(JSON.stringify({prepared:true,config,sourceCount:2,audioCaptureSources:false}));

/** Ephemeral display state only. No key codes, labels, held keys or filesystem paths. */
export interface CharacterIdentity { id:string; revision:string; outfitId:string }
export interface CharacterReactionState { event:'idle'|'typing'|'pet'; index:number; elapsedMs:number }
export interface CharacterContinuousState {
  privacy:boolean;
  petEnergy:number;
  petInside:boolean;
  moodTier:0|1|2;
  typingHeat:number;
  blushLevel:number;
  blinkRemainingMs:number;
  phaseMs:number;
  reaction:CharacterReactionState|null;
}
export interface CharacterStateFrame {
  version:1;
  epoch:string;
  sequence:number;
  capturedAt:number;
  identity:CharacterIdentity;
  state:CharacterContinuousState;
}
export const CHARACTER_STATE_TTL_MS=2000;
export const BUILTIN_CHARACTER:CharacterIdentity={id:'dafeiyu',revision:'builtin-2d-v1',outfitId:'builtin'};
export function identityKey(value:CharacterIdentity|null):string {
  return value ? `${value.id}/${value.revision}/${value.outfitId}` : '';
}
function object(value:unknown,keys:string[]):value is Record<string,unknown> {
  return !!value&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
}
function number(value:unknown,min:number,max:number,integer=false):value is number {
  return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max&&(!integer||Number.isInteger(value));
}
function id(value:unknown):value is string {return typeof value==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(value)
  &&! /^(con|prn|aux|nul|(com|lpt)[1-9])$/.test(value);}
export function compareEpoch(a:string,b:string):number {return a.length-b.length||(a<b?-1:a>b?1:0);}
function validEpoch(value:unknown):value is string {return typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)
  &&compareEpoch(value,'18446744073709551615')<=0;}
export function isCharacterStateFrame(value:unknown):value is CharacterStateFrame {
  if(!object(value,['version','epoch','sequence','capturedAt','identity','state'])||value.version!==1
    ||!validEpoch(value.epoch)
    ||!number(value.sequence,0,Number.MAX_SAFE_INTEGER,true)||!number(value.capturedAt,0,Number.MAX_SAFE_INTEGER,true))return false;
  const identity=value.identity,state=value.state;
  if(!object(identity,['id','revision','outfitId'])||!id(identity.id)||!id(identity.outfitId)
    ||typeof identity.revision!=='string'||!(/^[a-f0-9]{64}$/.test(identity.revision)
      ||identity.id==='dafeiyu'&&identity.revision==='builtin-2d-v1'&&identity.outfitId==='builtin'))return false;
  if(!object(state,['privacy','petEnergy','petInside','moodTier','typingHeat','blushLevel','blinkRemainingMs','phaseMs','reaction'])
    ||typeof state.privacy!=='boolean'||typeof state.petInside!=='boolean'
    ||!number(state.petEnergy,0,1)||!number(state.moodTier,0,2,true)||!number(state.typingHeat,0,1)
    ||!number(state.blushLevel,0,1)||!number(state.blinkRemainingMs,0,2000)
    ||!number(state.phaseMs,0,Number.MAX_SAFE_INTEGER))return false;
  if(state.reaction!==null&&(!object(state.reaction,['event','index','elapsedMs'])
    ||!['idle','typing','pet'].includes(String(state.reaction.event))||!number(state.reaction.index,0,31,true)
    ||!number(state.reaction.elapsedMs,0,60000)))return false;
  return !state.privacy||(state.petEnergy===0&&state.moodTier===0&&state.typingHeat===0&&state.reaction===null);
}

interface ReceiverTarget {
  identity():CharacterIdentity|null;
  privacy():boolean;
  apply(state:CharacterContinuousState,ageMs:number):void;
  reset():void;
}
/** Gate by epoch, sequence, identity, privacy and age; late loads never revive an old actor. */
export class CharacterStateReceiver {
  private target:ReceiverTarget;
  private wallClock:()=>number;
  private epoch='0';
  private sequence=-1;
  private pending:CharacterStateFrame|null=null;
  private applied:CharacterStateFrame|null=null;
  private identity='';
  private active=false;
  constructor(target:ReceiverTarget,wallClock:()=>number=Date.now){this.target=target;this.wallClock=wallClock;}
  invalidate(epoch:string):void {
    if(!validEpoch(epoch)||compareEpoch(epoch,this.epoch)<0)return;
    this.epoch=epoch;this.sequence=-1;this.disconnect();
  }
  disconnect():void {this.pending=this.applied=null;this.active=false;this.sequence=-1;this.target.reset();}
  // A newly opened EventSource cannot deliver old-connection events. Native restarts reset epochs.
  reconnect():void {this.epoch='0';this.disconnect();}
  receive(value:unknown):boolean {
    if(!isCharacterStateFrame(value)||compareEpoch(value.epoch,this.epoch)<0)return false;
    if(compareEpoch(value.epoch,this.epoch)>0)this.invalidate(value.epoch);
    if(value.sequence<=this.sequence)return false;
    const age=this.wallClock()-value.capturedAt;
    if(age< -CHARACTER_STATE_TTL_MS||age>CHARACTER_STATE_TTL_MS)return false;
    this.sequence=value.sequence;this.pending=value;this.tick();return true;
  }
  tick():void {
    const identity=identityKey(this.target.identity());
    if(identity!==this.identity){this.identity=identity;this.applied=null;this.active=false;this.target.reset();}
    const frame=this.pending;
    if(!frame)return;
    const age=Math.max(0,this.wallClock()-frame.capturedAt);
    if(age>CHARACTER_STATE_TTL_MS){this.pending=null;if(this.active){this.target.reset();this.active=false;}return;}
    if(identityKey(frame.identity)!==identity||frame.state.privacy!==this.target.privacy()){
      if(this.active){this.target.reset();this.active=false;this.applied=null;}return;
    }
    if(frame!==this.applied){this.target.apply(frame.state,age);this.applied=frame;this.active=true;}
  }
}

/** At most one IPC request chain in flight. Capture after obtaining the current native epoch. */
export class CharacterStatePublisher {
  private sequence=0;
  private busy=false;
  private token:()=>Promise<string>;
  private capture:()=>{identity:CharacterIdentity;state:CharacterContinuousState}|null;
  private send:(frame:CharacterStateFrame)=>Promise<unknown>;
  constructor(token:()=>Promise<string>,capture:()=>{identity:CharacterIdentity;state:CharacterContinuousState}|null,
    send:(frame:CharacterStateFrame)=>Promise<unknown>){this.token=token;this.capture=capture;this.send=send;}
  async tick():Promise<void>{
    if(this.busy)return;this.busy=true;
    try{const epoch=await this.token(),value=this.capture();if(value)await this.send({version:1,epoch,
      sequence:++this.sequence,capturedAt:Date.now(),...value});}finally{this.busy=false;}
  }
}

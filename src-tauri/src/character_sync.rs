//! In-memory OBS display state. Never persists input or accepts package executable code.
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const MAX_SAFE: u64 = 9_007_199_254_740_991;
const TTL_MS: u64 = 2000;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Identity { id:String, revision:String, outfit_id:String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Reaction { event:String, index:u32, elapsed_ms:f64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ContinuousState {
    privacy:bool, pet_energy:f64, pet_inside:bool, mood_tier:u8, typing_heat:f64,
    blush_level:f64, blink_remaining_ms:f64, phase_ms:f64,
    #[serde(deserialize_with="required_reaction")]
    reaction:Option<Reaction>,
}
fn required_reaction<'de,D:serde::Deserializer<'de>>(deserializer:D)->Result<Option<Reaction>,D::Error> {
    Option::<Reaction>::deserialize(deserializer)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Frame {
    version:u8, epoch:String, sequence:u64, captured_at:u64, identity:Identity, state:ContinuousState,
}
struct Cache { epoch:u64, sequence:Option<u64>, frame:Option<Frame> }
static CACHE:OnceLock<Mutex<Cache>>=OnceLock::new();
fn cache()-> &'static Mutex<Cache> {CACHE.get_or_init(||Mutex::new(Cache{epoch:1,sequence:None,frame:None}))}
fn now_ms()->u64 {SystemTime::now().duration_since(UNIX_EPOCH).map(|d|d.as_millis() as u64).unwrap_or(0)}
fn bounded(value:f64,min:f64,max:f64)->bool {value.is_finite()&&value>=min&&value<=max}
fn valid(frame:&Frame)->bool {
    let s=&frame.state;
    let id=&frame.identity;
    frame.version==1&&frame.sequence<=MAX_SAFE&&frame.captured_at<=MAX_SAFE
        &&frame.epoch.parse::<u64>().ok().is_some_and(|epoch|epoch.to_string()==frame.epoch)
        &&crate::characters::valid_id(&id.id)&&crate::characters::valid_id(&id.outfit_id)
        &&((id.revision.len()==64&&id.revision.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c)))
            ||id.id=="dafeiyu"&&id.outfit_id=="builtin"&&id.revision=="builtin-2d-v1")
        &&bounded(s.pet_energy,0.0,1.0)&&s.mood_tier<=2&&bounded(s.typing_heat,0.0,1.0)
        &&bounded(s.blush_level,0.0,1.0)&&bounded(s.blink_remaining_ms,0.0,2000.0)
        &&bounded(s.phase_ms,0.0,MAX_SAFE as f64)
        &&s.reaction.as_ref().is_none_or(|r|matches!(r.event.as_str(),"idle"|"typing"|"pet")
            &&r.index<=31&&bounded(r.elapsed_ms,0.0,60000.0))
        &&(!s.privacy||(s.pet_energy==0.0&&s.mood_tier==0&&s.typing_heat==0.0&&s.reaction.is_none()))
}
pub fn invalidate()->String {
    let mut cache=cache().lock().unwrap();
        cache.epoch=cache.epoch.checked_add(1).expect("character epoch exhausted");
        cache.sequence=None;cache.frame=None;let epoch=cache.epoch.to_string();
    crate::obs::broadcast_raw("characterReset",&serde_json::json!({"epoch":epoch}).to_string());epoch
}
pub fn epoch(restart:bool)->String {
    if restart {invalidate()}else{cache().lock().unwrap().epoch.to_string()}
}
pub fn snapshot()->Option<Frame> {
    cache().lock().unwrap().frame.clone().filter(|frame|now_ms().abs_diff(frame.captured_at)<=TTL_MS
        &&frame.state.privacy==crate::obs::privacy_active())
}
pub fn publish(app:&tauri::AppHandle,frame:Frame)->Result<bool,String> {
    if !valid(&frame){return Err("Invalid character display state".into());}
    // Settings events can invalidate the cache while their caller holds this mutex.
    // Never acquire the application settings mutex under the sync cache lock.
    let settings=app.state::<crate::AppState>().settings.lock().unwrap().clone();
    if now_ms().abs_diff(frame.captured_at)>TTL_MS||frame.state.privacy!=crate::obs::privacy_active(){return Ok(false);}
    let mut cache=cache().lock().unwrap();
    if frame.epoch!=cache.epoch.to_string()||cache.sequence.is_some_and(|seq|frame.sequence<=seq){return Ok(false);}
    if let Some(id)=settings.active_character_id {
        if frame.identity.id!=id{return Ok(false);}
        let registry=crate::characters::load_registry().map_err(|e|e.message)?;
        let Some(entry)=registry.characters.get(&id)else{return Ok(false);};
        if frame.identity.revision!=entry.revision||!entry.playable_outfits.contains(&frame.identity.outfit_id){return Ok(false);}
        if settings.character_outfits.get(&id).filter(|saved|entry.outfits.contains(saved))
            .is_some_and(|saved|saved!=&frame.identity.outfit_id){return Ok(false);}
    }else if settings.cat_breed!="dafeiyu"||frame.identity.id!="dafeiyu"
        ||frame.identity.revision!="builtin-2d-v1"||frame.identity.outfit_id!="builtin" {return Ok(false);}
    let payload=serde_json::to_string(&frame).map_err(|e|e.to_string())?;
    cache.sequence=Some(frame.sequence);cache.frame=Some(frame);
    // Keep publication ordered with invalidation, so a reset cannot be followed by an older epoch.
    crate::obs::broadcast_raw("characterState",&payload);Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn display_frame_rejects_private_fields_and_invalid_privacy() {
        let value=serde_json::json!({"version":1,"epoch":"1","sequence":1,"capturedAt":1000,
            "identity":{"id":"dafeiyu","revision":"builtin-2d-v1","outfitId":"builtin"},
            "state":{"privacy":false,"petEnergy":0.5,"petInside":true,"moodTier":0,"typingHeat":0.0,
                "blushLevel":0.2,"blinkRemainingMs":0.0,"phaseMs":100.0,"reaction":null}});
        let mut frame:Frame=serde_json::from_value(value.clone()).unwrap();assert!(valid(&frame));
        frame.state.privacy=true;assert!(!valid(&frame));
        let mut private=value;private["state"]["rawKeys"]=serde_json::json!([65]);
        assert!(serde_json::from_value::<Frame>(private).is_err());
    }
}

//! Selection is separate from legacy whole-settings writes, so they cannot erase character choice.
use crate::characters::{error, io_error, read_bounded, valid_id, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub active_character_id: Option<String>,
    pub character_outfits: BTreeMap<String, String>,
}
impl Default for Selection {
    fn default() -> Self { Self { active_character_id: None, character_outfits: BTreeMap::new() } }
}
pub fn load() -> Result<Selection> { load_at(&crate::config::app_data_dir()) }
/// Resolve a removed outfit for display without overwriting the user's stored preferences.
pub fn view() -> Result<Selection> { view_at(&crate::config::app_data_dir()) }
pub(crate) fn view_at(root:&Path) -> Result<Selection> {
    let mut selection=load_at(root)?;
    if let Some(id)=selection.active_character_id.as_ref() {
        if let Ok(registry)=crate::characters::load_registry_at(root) {
            if let Some(entry)=registry.characters.get(id) {
                if let Ok(outfit)=outfit_for_entry(root,entry,selection.character_outfits.get(id).map(String::as_str)) {
                    selection.character_outfits.insert(id.clone(),outfit);
                }
            }
        }
    }
    Ok(selection)
}
fn outfit_for_entry(root:&Path,entry:&crate::characters::Entry,preferred:Option<&str>) -> Result<String> {
    if let Some(preferred)=preferred.filter(|id|entry.outfits.iter().any(|candidate|candidate.as_str()==*id)) {
        return Ok(preferred.to_string());
    }
    if let Some(id)=&entry.default_outfit_id {return Ok(id.clone());}
    // Older registries lack the default metadata. Read only the bounded manifest, not every PNG.
    let path=root.join("characters").join(&entry.id).join(&entry.revision).join("character.json");
    let manifest:crate::characters::Manifest=serde_json::from_slice(&read_bounded(&path,crate::characters::MAX_MANIFEST)?)
        .map_err(|e|error("INVALID_MANIFEST",e.to_string()))?;
    if manifest.id!=entry.id||!entry.outfits.contains(&manifest.default_outfit_id) {
        return Err(error("INVALID_REGISTRY","Default outfit metadata disagrees with manifest"));
    }
    Ok(manifest.default_outfit_id)
}
pub(crate) fn load_at(root: &Path) -> Result<Selection> {
    let path = root.join("character-selection.json");
    match std::fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Selection::default()),
        Err(e) => return Err(io_error(e)),
        _ => {},
    }
    let value: Selection = serde_json::from_slice(&read_bounded(&path, 65536)?)
        .map_err(|e| error("INVALID_SELECTION", e.to_string()))?;
    if value.character_outfits.len() > 256 || value.active_character_id.as_ref().is_some_and(|id| !valid_id(id))
        || value.character_outfits.iter().any(|(id, outfit)| !valid_id(id) || !valid_id(outfit)) {
        return Err(error("INVALID_SELECTION", "Invalid selection identifiers"));
    }
    Ok(value)
}
fn save(root: &Path, value: &Selection) -> Result<()> {
    let target = root.join("character-selection.json");
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| error("IO_ERROR", e.to_string()))?.as_nanos();
    let temp = target.with_extension(format!("{}.{}.tmp", std::process::id(), nonce));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(io_error)?;
    file.write_all(&serde_json::to_vec_pretty(value).map_err(|e| error("INVALID_SELECTION", e.to_string()))?).map_err(io_error)?;
    file.sync_all().map_err(io_error)?; drop(file);
    std::fs::rename(temp, target).map_err(io_error)
}
pub fn clear() -> Result<()> { clear_at(&crate::config::app_data_dir()) }
pub(crate) fn clear_at(root: &Path) -> Result<()> {
    match std::fs::symlink_metadata(root.join("character-selection.json")) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(io_error(e)),
        _ => {},
    }
    let _lock = crate::character_import::acquire_lock_at(root)?;
    clear_locked_at(root)
}
pub(crate) fn clear_locked_at(root:&Path)->Result<()> {
    match std::fs::symlink_metadata(root.join("character-selection.json")) {
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(()),
        Err(e)=>return Err(io_error(e)), _=>{},
    }
    let mut selection = load_at(root).unwrap_or_default();
    selection.active_character_id = None;
    save(root, &selection)
}
pub fn choose(id: &str, outfit: Option<&str>, activate: bool) -> Result<Value> {
    choose_at(&crate::config::app_data_dir(), id, outfit, activate)
}
pub(crate) fn choose_at(root: &Path, id: &str, outfit: Option<&str>, activate: bool) -> Result<Value> {
    if !valid_id(id) { return Err(error("INVALID_ARGUMENT", "Invalid character ID")); }
    let _lock = crate::character_import::acquire_lock_at(root)?;
    let package = crate::character_import::read_registered(root, id)?;
    let manifest: crate::characters::Manifest = serde_json::from_value(package["manifest"].clone())
        .map_err(|e| error("INVALID_MANIFEST", e.to_string()))?;
    let mut selection = load_at(root)?;
    let target = outfit.or_else(|| selection.character_outfits.get(id).map(String::as_str))
        .filter(|candidate| manifest.outfits.iter().any(|o| o.id == *candidate))
        .unwrap_or(&manifest.default_outfit_id).to_string();
    if outfit.is_some_and(|requested| requested != target) { return Err(error("OUTFIT_NOT_FOUND", "Unknown outfit")); }
    let selected = manifest.outfits.iter().find(|o| o.id == target).expect("checked outfit");
    if selected.motion2d.is_none() || selected.body_sprites.is_none() {
        return Err(error("ACTIVATION_UNAVAILABLE", "This player requires procedural-2d-v1 motion and body sprites"));
    }
    if !selection.character_outfits.contains_key(id) && selection.character_outfits.len() >= 256 {
        return Err(error("LIMIT_EXCEEDED", "Outfit preference limit reached"));
    }
    selection.character_outfits.insert(id.to_string(), target.clone());
    if activate { selection.active_character_id = Some(id.to_string()); }
    save(root, &selection)?;
    Ok(json!({"id":id,"outfitId":target,"activeCharacterId":selection.active_character_id,"activated":selection.active_character_id.as_deref()==Some(id)}))
}
pub fn active() -> Result<Value> {
    let selection = view()?;
    let Some(id) = selection.active_character_id else { return Ok(Value::Null); };
    let mut value = crate::character_import::read_registered(&crate::config::app_data_dir(), &id)?;
    let outfits = value["manifest"]["outfits"].as_array().ok_or_else(|| error("INVALID_MANIFEST", "Missing outfits"))?;
    let preferred = selection.character_outfits.get(&id);
    let outfit = preferred.filter(|candidate| outfits.iter().any(|o| o["id"].as_str() == Some(candidate.as_str())))
        .map(String::as_str).or_else(|| value["manifest"]["defaultOutfitId"].as_str()).unwrap_or("").to_string();
    value["outfitId"] = json!(outfit);
    Ok(value)
}

pub fn active_layouts() -> Result<Option<(String, crate::motion2d_types::Layouts)>> {
    let value = active()?;
    if value.is_null() { return Ok(None); }
    let id = value["entry"]["id"].as_str().ok_or_else(|| error("INVALID_REGISTRY", "Missing character ID"))?;
    let outfit_id = value["outfitId"].as_str().unwrap_or("");
    let outfit = value["manifest"]["outfits"].as_array().and_then(|outfits|
        outfits.iter().find(|outfit| outfit["id"].as_str() == Some(outfit_id)))
        .ok_or_else(|| error("OUTFIT_NOT_FOUND", "Selected outfit missing"))?;
    let motion: crate::motion2d_types::Motion2d = serde_json::from_value(outfit["motion2d"].clone())
        .map_err(|e| error("ACTIVATION_UNAVAILABLE", e.to_string()))?;
    Ok(Some((id.to_string(), motion.layouts)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removed_outfit_projects_default_without_changing_saved_preference() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("kurocat-outfit-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let mut selection = Selection::default();
        selection.active_character_id = Some("motion-fixture".into());
        selection.character_outfits.insert("motion-fixture".into(), "alternate".into());
        save(&root, &selection).unwrap();
        let path = root.join("character-selection.json");
        let before = std::fs::read(&path).unwrap();
        let mut entry = json!({"id":"motion-fixture","revision":"a".repeat(64),"name":"Test fixture","version":"0.2.0",
            "outfits":["primary"],"playableOutfits":["primary"],"defaultOutfitId":"primary"});
        let registry_path = root.join("characters.json");
        let write_registry = |entry: &Value| std::fs::write(&registry_path,
            serde_json::to_vec(&json!({"schemaVersion":1,"generation":2,"characters":{"motion-fixture":entry}})).unwrap()).unwrap();
        write_registry(&entry);
        assert_eq!(view_at(&root).unwrap().character_outfits["motion-fixture"], "primary");
        assert_eq!(std::fs::read(&path).unwrap(), before);
        entry["defaultOutfitId"] = json!("removed");
        write_registry(&entry);
        assert!(crate::characters::load_registry_at(&root).is_err());
        entry.as_object_mut().unwrap().remove("defaultOutfitId");
        write_registry(&entry);
        let manifest_dir = root.join("characters/motion-fixture").join("a".repeat(64));
        std::fs::create_dir_all(&manifest_dir).unwrap();
        let mut manifest = crate::characters::schema_guide()["genericExample"].clone();
        manifest["id"] = json!("motion-fixture");
        manifest["defaultOutfitId"] = json!("primary");
        manifest["outfits"][0]["id"] = json!("primary");
        std::fs::write(manifest_dir.join("character.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert_eq!(view_at(&root).unwrap().character_outfits["motion-fixture"], "primary");
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}

//! Extension-only package contract; importing does not activate a renderer.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

pub const MAX_MANIFEST: u64 = 256 * 1024;
pub const MAX_PACKAGE: u64 = 64 * 1024 * 1024;
pub const MAX_ASSETS: usize = 128;
pub const MAX_PIXELS: u64 = 32 * 1024 * 1024;
pub const MAX_REGISTRY: u64 = 4 * 1024 * 1024;
pub const STATES: [&str; 6] = ["idle", "typing", "mouse", "interaction", "rest", "privacy"];

#[derive(Debug, Serialize)]
pub struct PackageError {
    pub code: &'static str,
    pub message: String,
}
pub type Result<T> = std::result::Result<T, PackageError>;
pub fn error(code: &'static str, message: impl Into<String>) -> PackageError {
    PackageError { code, message: message.into() }
}
pub fn io_error(e: std::io::Error) -> PackageError {
    error("IO_ERROR", e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub license: String,
    pub renderer: String,
    pub logical_size: [u32; 2],
    pub anchor: [i32; 2],
    pub default_outfit_id: String,
    pub outfits: Vec<Outfit>,
    pub animations: BTreeMap<String, Animation>,
    pub behavior: Behavior,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_notice: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BodySprites {
    pub profile: String,
    pub idle: String,
    pub blink: String,
    pub shy: String,
    pub happy: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Outfit {
    pub id: String,
    pub name: String,
    /// Each mandatory state maps to one or more weighted action variants.
    pub actions: BTreeMap<String, Vec<Variant>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_sprites: Option<BodySprites>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motion2d: Option<crate::motion2d::Motion2d>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Variant {
    pub animation: String,
    pub weight: u32,
    pub cooldown_ms: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Behavior {
    pub rest_after_ms: u32,
    pub input_release_ms: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Animation {
    pub looping: bool,
    pub frames: Vec<Frame>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Frame {
    pub duration_ms: u32,
    pub layers: Vec<Layer>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layer {
    pub asset: String,
    /// x, y, width, height in source PNG pixels.
    pub rect: [u32; 4],
    pub anchor: [i32; 2],
    pub plane: String,
    /// Optional per-keyboard destination anchors; keys are 65 and/or 108.
    #[serde(default)]
    pub layout_anchors: BTreeMap<String, [i32; 2]>,
}

pub fn registry_path() -> PathBuf {
    crate::config::app_data_dir().join("characters.json")
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 48
        && id.as_bytes()[0].is_ascii_lowercase()
        && id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        && !matches!(id, "con" | "prn" | "aux" | "nul")
        && !(id.len() == 4 && (id.starts_with("com") || id.starts_with("lpt"))
            && matches!(id.as_bytes()[3], b'1'..=b'9'))
}
pub fn check_plain_path(path: &Path) -> Result<()> {
    // Inspect every ancestor too: canonicalization alone would accept a junction.
    for part in path.ancestors() {
        let meta = std::fs::symlink_metadata(part).map_err(io_error)?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(error("UNSAFE_PATH", "Reparse points are not allowed"));
            }
        }
        if meta.file_type().is_symlink() {
            return Err(error("UNSAFE_PATH", "Symbolic links are not allowed"));
        }
    }
    Ok(())
}
pub fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>> {
    check_plain_path(path)?;
    if !std::fs::symlink_metadata(path).map_err(io_error)?.is_file() {
        return Err(error("UNSAFE_PATH", "Expected a regular file"));
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    reject_final_reparse_point(&mut options);
    let file = options.open(path).map_err(io_error)?;
    check_regular_handle(&file)?;
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(io_error)?;
    if bytes.len() as u64 > limit {
        return Err(error("LIMIT_EXCEEDED", "File exceeds size limit"));
    }
    Ok(bytes)
}

pub fn reject_final_reparse_point(options: &mut std::fs::OpenOptions) {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_OPEN_REPARSE_POINT: inspect the opened object rather than follow a replaced link.
        options.custom_flags(0x0020_0000);
    }
    #[cfg(not(windows))]
    let _ = options;
}

pub fn check_regular_handle(file: &std::fs::File) -> Result<()> {
    let metadata = file.metadata().map_err(io_error)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(error("UNSAFE_PATH", "Opened file is a reparse point"));
        }
    }
    if !metadata.is_file() {
        return Err(error("UNSAFE_PATH", "Expected a regular file"));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub id: String,
    pub revision: String,
    pub name: String,
    pub version: String,
    pub outfits: Vec<String>,
    #[serde(default)]
    pub playable_outfits: Vec<String>,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub default_outfit_id: Option<String>,
}
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registry {
    pub schema_version: u32,
    pub generation: u64,
    pub characters: BTreeMap<String, Entry>,
}
pub fn load_registry() -> Result<Registry> {
    load_registry_at(&crate::config::app_data_dir())
}
pub fn load_registry_at(root: &Path) -> Result<Registry> {
    let path = root.join("characters.json");
    match std::fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Registry { schema_version: 1, ..Registry::default() }),
        Err(e) => return Err(io_error(e)),
        Ok(_) => {}
    }
    let registry: Registry = serde_json::from_slice(&read_bounded(&path, MAX_REGISTRY)?)
        .map_err(|e| error("INVALID_REGISTRY", e.to_string()))?;
    if registry.schema_version != 1 || registry.characters.len() > 256 {
        return Err(error("INVALID_REGISTRY", "Unsupported or oversized registry"));
    }
    for (id, entry) in &registry.characters {
        if !valid_id(id) || id != &entry.id || entry.revision.len() != 64
            || !entry.revision.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            || [&entry.name, &entry.version].into_iter().any(|value|
                value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control))
            || entry.outfits.is_empty() || entry.outfits.len() > 32
            || entry.outfits.iter().any(|outfit| !valid_id(outfit))
            || entry.outfits.iter().collect::<std::collections::BTreeSet<_>>().len() != entry.outfits.len() {
            return Err(error("INVALID_REGISTRY", "Invalid character metadata"));
        }
        if entry.playable_outfits.iter().any(|id| !entry.outfits.contains(id)) || entry.playable_outfits.len() > 32 {
            return Err(error("INVALID_REGISTRY", "Invalid playable outfit metadata"));
        }
        if entry.default_outfit_id.as_ref().is_some_and(|id|!entry.outfits.contains(id)) {
            return Err(error("INVALID_REGISTRY", "Default outfit is not registered"));
        }
    }
    Ok(registry)
}
pub fn list_characters() -> Result<Value> {
    let registry = load_registry()?;
    let characters: Vec<Value> = registry.characters.values().map(|entry| {
        let manifest = crate::config::app_data_dir().join("characters")
            .join(&entry.id).join(&entry.revision).join("character.json");
        json!({"entry": entry, "manifestPresent": manifest.is_file()})
    }).collect();
    Ok(json!({"schemaVersion": 1, "generation": registry.generation,
        "storagePath": registry_path(), "characters": characters,
        "activationSupported": true, "activeCharacterId": crate::character_selection::load().ok().and_then(|s| s.active_character_id),
        "note": "Procedural outfits can activate; frame-only packages remain importable. Manifest presence alone does not certify asset integrity."}))
}

pub fn schema_guide() -> Value {
    // The executable contract is the strict serde types and validator; publish a complete example.
    let actions: BTreeMap<_, _> = STATES.into_iter().map(|s| (s, json!([
        {"animation": "still", "weight": 1, "cooldownMs": 0}
    ]))).collect();
    let mut guide = json!({"schemaVersion": 1, "format": "kurocat-extension-directory", "schema": manifest_schema(),
        "storagePath": registry_path(), "activationSupported": true,
        "limits": {"manifestBytes": MAX_MANIFEST, "packageBytes": MAX_PACKAGE,
            "assets": MAX_ASSETS, "totalPixels": MAX_PIXELS, "imageSide": 4096,
            "animations": 128, "framesPerAnimation": 256, "totalFrames": 4096,
            "layersPerFrame": 3, "outfits": 32},
        "rules": ["Only assets/<filename>.png or assets/<outfit-id>/<filename>.png paths (underscores allowed in filenames); no scripts, URLs, ZIP or links",
            "MCP-created people should use bodySprites profile dafeiyu-body-v1: four aligned 224x278 8-bit RGBA body expressions without arms or tail, following the built-in BigFish assets",
            "Body expressions supply the aligned artwork; motion2d controls the shared hands, keyboard, optional tail, interaction, personality and privacy player",
            "Use one character ID with multiple outfits; give each outfit its own sprites, rig and motion/personality values",
            "Read get_character_package before editing; preserve the full manifest and assetNotice, and re-import with replace=true. Installed revision directories are immutable",
            "All six actions are required per outfit; combo is optional",
            "Planes: background, body, foreground; at most one of each per frame",
            "PNG must be static, 8-bit RGB or RGBA; all referenced frames are decoded and bounded",
            "This example is a contract fixture, not approved artwork"],
        "example": {"schemaVersion": 1, "id": "example-person", "name": "Example",
            "version": "1.0.0", "author": "Author", "license": "Specify asset license",
            "renderer": "canvas2d", "logicalSize": [420,440], "anchor": [210,400],
            "defaultOutfitId": "default", "outfits": [{"id":"default", "name":"Default", "actions":actions}],
            "behavior": {"restAfterMs": 28000, "inputReleaseMs": 180},
            "animations": {"still": {"looping": true, "frames": [{"durationMs":200,
                "layers":[{"asset":"assets/body.png", "rect":[0,0,1,1], "anchor":[210,400], "plane":"body"}]}]}}}});
    // Keep the original generic fixture for existing layered/atlas packages.
    guide["genericExample"] = guide["example"].clone();
    let mut example = guide["example"].clone();
    example["outfits"][0]["bodySprites"] = json!({"profile":"dafeiyu-body-v1",
        "idle":"assets/default/notail_idle.png", "blink":"assets/default/notail_blink.png",
        "shy":"assets/default/notail_shy.png", "happy":"assets/default/notail_happy2.png"});
    let mut animations = BTreeMap::new();
    for (state, file) in [("idle","idle"),("blink","blink"),("shy","shy"),("happy","happy2")] {
        animations.insert(state, json!({"looping":true,"frames":[{"durationMs":200,
            "layers":[{"asset":format!("assets/default/notail_{file}.png"),"rect":[0,0,224,278],
                "anchor":[210,400],"plane":"body"}]}]}));
    }
    example["animations"] = json!(animations);
    for (state, expression) in [("idle","idle"),("typing","idle"),("mouse","idle"),
        ("interaction","happy"),("rest","idle"),("privacy","blink")] {
        example["outfits"][0]["actions"][state] = json!([{ "animation":expression,"weight":1,"cooldownMs":0 }]);
    }
    example["outfits"][0]["motion2d"] = crate::motion2d::reference();
    guide["motionSchema"] = crate::motion2d::schema();
    guide["example"] = example;
    let mut builtin = guide["example"].clone();
    builtin["id"] = json!("dafeiyu-reference");
    builtin["name"] = json!("大肥鱼 2D 动作参考");
    builtin["author"] = json!("PC2005-cloud / dsh-pet contributors; KuroCat motion reference");
    builtin["license"] = json!("MIT");
    builtin["assetNotice"] = json!(include_str!("../../src/assets/dafeiyu/LICENSE-MIT.txt"));
    builtin["defaultOutfitId"] = json!("dafeiyu");
    builtin["outfits"][0]["id"] = json!("dafeiyu");
    for field in ["idle", "blink", "shy", "happy"] {
        let path = builtin["outfits"][0]["bodySprites"][field].as_str().unwrap().replace("assets/default/", "assets/dafeiyu/");
        builtin["outfits"][0]["bodySprites"][field] = json!(path);
    }
    for animation in builtin["animations"].as_object_mut().unwrap().values_mut() {
        for frame in animation["frames"].as_array_mut().unwrap() {
            for layer in frame["layers"].as_array_mut().unwrap() {
                layer["asset"] = json!(layer["asset"].as_str().unwrap().replace("assets/default/", "assets/dafeiyu/"));
            }
        }
    }
    guide["dafeiyuReferencePackage"] = builtin;
    guide["reference2d"] = json!({"source":"src/proceduralCharacterRenderer.ts + src/characterInteraction.ts + src/catEngine.ts",
        "renderer":"canvas2d", "threeD":false, "builtInRestAnimation":false, "builtInPurr":false,
        "behaviors":["breathing", "bodyBob", "blink", "typingMoodHysteresis", "blush",
            "gazeTracking", "twoHandTyping", "mouseTracking", "mouseButtons", "scrollFeedback",
            "simultaneousMouseKeyboardTail", "tailIdleWag", "tailTapHoldRelease", "tailPickerPreview",
            "intentionalPetStrokes", "petHappyHands", "heartAndWaterParticles", "privacyCoverEyes",
            "privacyTypingBob", "keyboardAndMouseBadges", "keyboardLayoutAndOrientation"],
        "interaction":"Real back-and-forth/rubbing strokes raise petEnergy; hovering alone does not. Privacy overrides happy and input.",
        "runtimeStatus":"The data-only motion2d protocol now saves rig, motion, personality, interaction, privacy and synchronization policy. A shared 2D player consumes the protocol; native integration is not yet runtime-verified."});
    guide["workflow"] = json!({
        "create":["Generate and save real aligned PNG expressions for every outfit on the MCP server machine",
            "Start from example; customize all outfit rigs, motion, personality and assetNotice",
            "Call validate_character_package with absolute path and optional complete inline manifest",
            "Call import_character_package; report entry/revision separately from activated and activationError"],
        "update":["Call get_character_package and preserve the returned manifest fields",
            "For configuration-only edits, use the returned packagePath as the read-only PNG source and pass the complete edited manifest inline",
            "For replacement PNGs, prepare a separate source directory; never edit installed revision files",
            "Validate and import with replace=true; read back and verify the new revision, then select the desired outfit"],
        "verification":"Saving, importing, selecting and visually verifying are separate outcomes; tool success does not prove native input, menus, restart or OBS validation"
    });
    guide
}

fn strict_object(properties: Value) -> Value {
    let required: Vec<_> = properties.as_object().unwrap().keys().cloned().collect();
    json!({"type":"object", "properties":properties, "required":required, "additionalProperties":false})
}
pub fn manifest_schema() -> Value {
    let id = json!({"type":"string", "pattern":"^[a-z][a-z0-9-]{0,47}$"});
    let text = json!({"type":"string", "minLength":1, "maxLength":256});
    let anchor = json!({"type":"array", "minItems":2, "maxItems":2, "items":{"type":"integer", "minimum":-4096, "maximum":4096}});
    let variant = strict_object(json!({"animation":id, "weight":{"type":"integer","minimum":1,"maximum":1000},
        "cooldownMs":{"type":"integer","minimum":0,"maximum":3600000}}));
    let variants = json!({"type":"array", "minItems":1, "maxItems":16, "items":variant});
    let mut actions = strict_object(json!(STATES.into_iter().map(|s| (s, variants.clone())).collect::<BTreeMap<_,_>>()));
    actions["properties"]["combo"] = variants;
    let asset = json!({"type":"string", "pattern":"^assets/(?:[a-z][a-z0-9-]{0,47}/)?[a-z][a-z0-9_-]{0,47}\\.png$"});
    let mut outfit = strict_object(json!({"id":id, "name":text, "actions":actions}));
    outfit["properties"]["bodySprites"] = strict_object(json!({
        "profile":{"const":"dafeiyu-body-v1"},"idle":asset,"blink":asset,"shy":asset,"happy":asset}));
    outfit["properties"]["motion2d"] = crate::motion2d::schema();
    let mut layer = strict_object(json!({"asset":asset,
        "rect":{"type":"array", "minItems":4, "maxItems":4, "items":{"type":"integer", "minimum":0,"maximum":4096}},
        "anchor":anchor, "plane":{"enum":["background","body","foreground"]}}));
    layer["properties"]["layoutAnchors"] = json!({"type":"object", "properties":{"65":anchor, "108":anchor}, "additionalProperties":false});
    let frame = strict_object(json!({"durationMs":{"type":"integer","minimum":1,"maximum":10000},
        "layers":{"type":"array","minItems":1,"maxItems":3,"items":layer}}));
    let animation = strict_object(json!({"looping":{"type":"boolean"},
        "frames":{"type":"array","minItems":1,"maxItems":256,"items":frame}}));
    let mut schema = strict_object(json!({"schemaVersion":{"const":1}, "id":id, "name":text,
        "version":text,"author":text,"license":text,"renderer":{"const":"canvas2d"},
        "logicalSize":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"integer","minimum":1,"maximum":2048}},
        "anchor":anchor, "defaultOutfitId":id,
        "outfits":{"type":"array","minItems":1,"maxItems":32,"items":outfit},
        "animations":{"type":"object","minProperties":1,"maxProperties":128,"propertyNames":id,"additionalProperties":animation},
        "behavior":strict_object(json!({"restAfterMs":{"type":"integer","minimum":1000,"maximum":3600000},
            "inputReleaseMs":{"type":"integer","minimum":0,"maximum":2000}}))}));
    schema["properties"]["assetNotice"] = json!({"type":"string","minLength":1,"maxLength":16384});
    schema["$schema"] = json!("https://json-schema.org/draft/2020-12/schema");
    schema["description"] = json!("Structural schema. Validator additionally checks UTF-8 byte limits, reserved names, references, unique IDs/planes, PNG decode, frame bounds and aggregate limits.");
    schema
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifiers_are_portable_and_not_sanitized() {
        for id in ["con", "com1", "lpt9", "../cat", "Cat", "a:b", "", "-cat"] {
            assert!(!valid_id(id), "{id}");
        }
        assert!(valid_id("marin-school"));
    }
    #[test]
    fn published_example_matches_strict_types() {
        let manifest: Manifest = serde_json::from_value(schema_guide()["example"].clone()).unwrap();
        assert_eq!(manifest.outfits[0].actions.len(), 6);
    }
}

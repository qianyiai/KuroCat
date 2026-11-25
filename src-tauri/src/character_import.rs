use crate::characters::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

pub fn tool_definitions() -> Vec<Value> {
    let mut definitions = vec![
        json!({"name":"get_character_schema", "description":"Get the extension-only v1 directory package contract, limits and example. Procedural 2D playback and activation are supported in source; frame-only activation is unavailable.",
            "inputSchema":{"type":"object", "properties":{}, "additionalProperties":false}}),
        json!({"name":"list_characters", "description":"List imported extension characters and revisions. Does not imply rendering or asset health.",
            "inputSchema":{"type":"object", "properties":{}, "additionalProperties":false}}),
        json!({"name":"switch_character","description":"Activate a registered procedural 2D character.","inputSchema":{"type":"object","required":["id"],"properties":{"id":{"type":"string"},"outfitId":{"type":"string"}},"additionalProperties":false}}),
        json!({"name":"set_character_outfit","description":"Save an outfit choice; switches the live outfit if this character is active.","inputSchema":{"type":"object","required":["id","outfitId"],"properties":{"id":{"type":"string"},"outfitId":{"type":"string"}},"additionalProperties":false}}),
        json!({"name":"get_character_package", "description":"Read a registered character manifest including all saved motion and personality fields, verifying its content revision before editing.",
            "inputSchema":{"type":"object","required":["id"],"properties":{"id":{"type":"string"}},"additionalProperties":false}}),
        json!({"name":"validate_character_package", "description":"Read and validate a local directory without writing application data. Requires absolute path on the MCP server machine.",
            "inputSchema":{"type":"object", "required":["path"], "properties":{"path":{"type":"string"}}, "additionalProperties":false}}),
        json!({"name":"import_character_package", "description":"Validate and copy a local directory into the extension registry. replace=true updates an existing character; activate=true selects a supported procedural 2D outfit after import.",
            "inputSchema":{"type":"object", "required":["path"], "properties":{"path":{"type":"string"}, "replace":{"type":"boolean", "default":false}, "activate":{"type":"boolean", "default":false}}, "additionalProperties":false}}),
    ];
    for tool in &mut definitions {
        if matches!(tool["name"].as_str(), Some("validate_character_package" | "import_character_package")) {
            tool["inputSchema"]["properties"]["manifest"] = manifest_schema();
            let description=tool["description"].as_str().unwrap().to_string();
            tool["description"] = json!(format!("{description} Optional complete inline manifest carries motion, personality and assetNotice without modifying source files. One character may have multiple outfits. Preserve the manifest from get_character_package when updating; never edit installed revision files. Legacy frame-only packages remain importable but cannot activate."));
        }
    }
    definitions
}

pub fn is_tool(name: &str) -> bool {
    matches!(name, "get_character_schema" | "list_characters" | "get_character_package" | "switch_character" | "set_character_outfit" | "validate_character_package" | "import_character_package")
}

pub fn execute_tool(name: &str, args: &Value) -> Option<Result<Value>> {
    if !is_tool(name) { return None; }
    Some((|| {
        let object = args.as_object().ok_or_else(|| error("INVALID_ARGUMENT", "Expected object arguments"))?;
        let allowed: &[&str] = match name {
            "get_character_package" => &["id"],
            "switch_character" | "set_character_outfit" => &["id", "outfitId"],
            "validate_character_package" => &["path", "manifest"],
            "import_character_package" => &["path", "replace", "activate", "manifest"],
            _ => &[],
        };
        if object.keys().any(|k| !allowed.contains(&k.as_str())) { return Err(error("INVALID_ARGUMENT", "Unknown argument")); }
        match name {
            "get_character_schema" => Ok(schema_guide()),
            "list_characters" => list_characters(),
            "switch_character" | "set_character_outfit" => {
                let id = object.get("id").and_then(Value::as_str).ok_or_else(|| error("INVALID_ARGUMENT", "id required"))?;
                let outfit = object.get("outfitId").map(|v| v.as_str().ok_or_else(|| error("INVALID_ARGUMENT", "outfitId must be a string"))).transpose()?;
                if name == "set_character_outfit" && outfit.is_none() { return Err(error("INVALID_ARGUMENT", "outfitId required")); }
                crate::character_selection::choose(id, outfit, name == "switch_character")
            }
            "get_character_package" => {
                let id = object.get("id").and_then(Value::as_str)
                    .ok_or_else(|| error("INVALID_ARGUMENT", "Expected id string"))?;
                read_registered(&crate::config::app_data_dir(), id)
            }
            _ => {
                let path = object.get("path").and_then(Value::as_str).filter(|p| !p.is_empty())
                    .ok_or_else(|| error("INVALID_ARGUMENT", "Expected nonempty absolute path string"))?;
                let manifest = object.get("manifest");
                if manifest.is_some_and(|v| !v.is_object()) { return Err(error("INVALID_ARGUMENT", "manifest must be an object")); }
                if name == "validate_character_package" { return validate_with_manifest(Path::new(path), manifest); }
                for field in ["replace", "activate"] {
                    if object.get(field).is_some_and(|v| !v.is_boolean()) { return Err(error("INVALID_ARGUMENT", format!("{field} must be boolean"))); }
                }
                let activate = object.get("activate").and_then(Value::as_bool).unwrap_or(false);
                let mut result = import_with_manifest(Path::new(path), object.get("replace").and_then(Value::as_bool).unwrap_or(false), manifest)?;
                if activate {
                    let id = result["entry"]["id"].as_str().unwrap();
                    match crate::character_selection::choose(id, None, true) {
                        Ok(selection) => { result["activated"]=json!(true); result["selection"]=selection; },
                        Err(error) => { result["activationError"]=serde_json::to_value(error).unwrap(); },
                    }
                }
                Ok(result)
            }
        }
    })())
}

struct Package {
    manifest: Manifest,
    files: BTreeMap<String, Vec<u8>>,
    revision: String,
}

pub(crate) fn read_registered(root: &Path, id: &str) -> Result<Value> {
    if !valid_id(id) { return Err(error("INVALID_ARGUMENT", "Invalid character ID")); }
    let registry = load_registry_at(root)?;
    let entry = registry.characters.get(id).ok_or_else(|| error("CHARACTER_NOT_FOUND", "Character is not registered"))?;
    let package = inspect(&root.join("characters").join(id).join(&entry.revision))?;
    let outfits: Vec<_> = package.manifest.outfits.iter().map(|o| o.id.clone()).collect();
    if package.revision != entry.revision || package.manifest.id != id
        || package.manifest.name != entry.name || package.manifest.version != entry.version
        || outfits != entry.outfits || entry.default_outfit_id.as_ref().is_some_and(|id|id!=&package.manifest.default_outfit_id) {
        return Err(error("INVALID_REGISTRY", "Stored package does not match its registered revision"));
    }
    let playable=package.manifest.outfits.iter().any(|o|o.motion2d.is_some()&&o.body_sprites.is_some());
    Ok(json!({"entry":entry,"manifest":package.manifest,"packagePath":root.join("characters").join(id).join(&entry.revision),"integrityChecked":true,"activationSupported":playable}))
}

pub fn asset_bytes(id: &str, revision: &str, asset: &str) -> Result<Vec<u8>> {
    let registry = load_registry()?;
    let entry = registry.characters.get(id).ok_or_else(|| error("CHARACTER_NOT_FOUND", "Unknown character"))?;
    if entry.revision != revision { return Err(error("STALE_REVISION", "Character revision changed")); }
    let root = crate::config::app_data_dir().join("characters").join(id).join(revision);
    let mut package = inspect(&root)?;
    if package.revision != revision || package.manifest.id != id {
        return Err(error("INVALID_REGISTRY", "Asset package no longer matches its content revision"));
    }
    if !package.manifest.outfits.iter().filter_map(|o| o.body_sprites.as_ref()).any(|s|
        [&s.idle,&s.blink,&s.shy,&s.happy].iter().any(|p| p.as_str()==asset)) {
        return Err(error("UNSAFE_PATH", "Asset is not a declared body sprite"));
    }
    package.files.remove(asset).ok_or_else(|| error("ASSET_MISSING", "Sprite missing from verified snapshot"))
}

fn invalid(message: impl Into<String>) -> PackageError {
    error("INVALID_MANIFEST", message)
}
fn asset_path(root: &Path, asset: &str) -> Result<PathBuf> {
    let parts: Vec<_> = asset.split('/').collect();
    let filename = match parts.as_slice() {
        ["assets", filename] => *filename,
        ["assets", outfit, filename] if valid_id(outfit) => *filename,
        _ => return Err(error("UNSAFE_PATH", "Expected assets/[outfit-id/]<filename>.png")),
    };
    let name = filename.strip_suffix(".png").ok_or_else(|| error("UNSAFE_PATH", "Expected PNG filename"))?;
    if !valid_id(&name.replace('_', "-")) {
        return Err(error("UNSAFE_PATH", "Invalid asset filename"));
    }
    let path = root.join(asset);
    check_plain_path(&path).map_err(|e| {
        if e.code == "IO_ERROR" { error("ASSET_MISSING", format!("{asset}: {}", e.message)) } else { e }
    })?;
    if !path.canonicalize().map_err(io_error)?.starts_with(root) {
        return Err(error("UNSAFE_PATH", "Asset escapes package root"));
    }
    Ok(path)
}

fn inspect(path: &Path) -> Result<Package> {
    inspect_with_manifest(path, None)
}
fn inspect_with_manifest(path: &Path, manifest: Option<&Value>) -> Result<Package> {
    if !path.is_absolute() || !path.is_dir() {
        return Err(error("UNSAFE_PATH", "Use an absolute local package directory"));
    }
    #[cfg(windows)]
    if !matches!(path.components().next(), Some(std::path::Component::Prefix(prefix))
        if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_))) {
        return Err(error("UNSAFE_PATH", "Network paths are not supported"));
    }
    check_plain_path(path)?;
    let root = path.canonicalize().map_err(io_error)?;
    let bytes = match manifest {
        Some(value) => {
            let bytes = serde_json::to_vec(value).map_err(|e| invalid(e.to_string()))?;
            if bytes.len() as u64 > MAX_MANIFEST { return Err(error("LIMIT_EXCEEDED", "Inline manifest exceeds limit")); }
            bytes
        }
        None => read_bounded(&root.join("character.json"), MAX_MANIFEST)?,
    };
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| invalid(e.to_string()))?;
    if value.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(error("UNSUPPORTED_SCHEMA", "Expected schemaVersion 1"));
    }
    let m: Manifest = serde_json::from_slice(&bytes).map_err(|e| invalid(e.to_string()))?;
    if !valid_id(&m.id) || m.renderer != "canvas2d" {
        return Err(invalid("Expected portable ID and renderer=canvas2d"));
    }
    for (field, value) in [("name", &m.name), ("version", &m.version), ("author", &m.author), ("license", &m.license)] {
        if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
            return Err(invalid(format!("{field} must be 1..256 bytes without control characters")));
        }
    }
    if m.asset_notice.as_ref().is_some_and(|s| s.trim().is_empty() || s.len() > 16384
        || s.chars().any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')) {
        return Err(invalid("assetNotice must be 1..16384 bytes of plain text"));
    }
    if m.logical_size.iter().any(|n| *n == 0 || *n > 2048)
        || !bounded_anchor(m.anchor)
        || m.behavior.rest_after_ms < 1000 || m.behavior.rest_after_ms > 3_600_000
        || m.behavior.input_release_ms > 2000 {
        return Err(invalid("Invalid canvas, anchor, or behavior timing"));
    }
    if m.outfits.is_empty() || m.outfits.len() > 32 || m.animations.is_empty() || m.animations.len() > 128 {
        return Err(invalid("Expected 1..32 outfits and 1..128 animations"));
    }
    let mut ids = BTreeSet::new();
    for outfit in &m.outfits {
        if !valid_id(&outfit.id) || !ids.insert(outfit.id.clone()) || outfit.name.trim().is_empty() || outfit.name.len() > 256 || outfit.name.chars().any(char::is_control) {
            return Err(invalid("Invalid or duplicate outfit ID/name"));
        }
        if let Some(motion) = &outfit.motion2d {
            crate::motion2d::validate(motion)?;
            if outfit.body_sprites.is_none() || motion.rig.source_size != [224, 278] {
                return Err(invalid("motion2d requires the 224x278 bodySprites profile"));
            }
            if motion.layouts.compact.logical_size != m.logical_size {
                return Err(invalid("Compact motion layout must match manifest logicalSize"));
            }
            let sprites = outfit.body_sprites.as_ref().expect("checked above");
            if let Some(privacy) = outfit.actions.get("privacy") {
                for variant in privacy {
                    if let Some(animation) = m.animations.get(&variant.animation) {
                        if animation.frames.iter().any(|frame| !frame.layers.iter().any(|layer|
                            layer.plane == "body" && layer.asset == sprites.blink)) {
                            return Err(error("INVALID_MOTION", "Procedural privacy frames must use the closed-eye body sprite"));
                        }
                    }
                }
            }
        }
        for state in STATES {
            if !outfit.actions.contains_key(state) { return Err(invalid(format!("Missing {state} action in {}", outfit.id))); }
        }
        for (state, variants) in &outfit.actions {
            if (!STATES.contains(&state.as_str()) && state != "combo") || variants.is_empty() || variants.len() > 16 {
                return Err(invalid("Unknown action or invalid variant count"));
            }
            for v in variants {
                if !m.animations.contains_key(&v.animation) || v.weight == 0 || v.weight > 1000 || v.cooldown_ms > 3_600_000 {
                    return Err(invalid("Invalid animation reference, weight, or cooldown"));
                }
            }
        }
    }
    if !ids.contains(&m.default_outfit_id) { return Err(invalid("Unknown defaultOutfitId")); }
    let mut files = BTreeMap::new();
    let mut dimensions = BTreeMap::new();
    let canonical_manifest = serde_json::to_vec_pretty(&m).map_err(|e| invalid(e.to_string()))?;
    if canonical_manifest.len() as u64 > MAX_MANIFEST {
        return Err(error("LIMIT_EXCEEDED", "Normalized manifest exceeds size limit"));
    }
    let mut total_bytes = canonical_manifest.len() as u64;
    let mut total_pixels = 0u64;
    let mut total_frames = 0usize;
    for (id, animation) in &m.animations {
        if !valid_id(id) || animation.frames.is_empty() || animation.frames.len() > 256 {
            return Err(invalid("Invalid animation ID or frame count"));
        }
        total_frames += animation.frames.len();
        if total_frames > 4096 { return Err(error("LIMIT_EXCEEDED", "Too many frames")); }
        for frame in &animation.frames {
            if frame.duration_ms == 0 || frame.duration_ms > 10_000 || frame.layers.is_empty() || frame.layers.len() > 3 {
                return Err(invalid("Invalid frame duration or layer count"));
            }
            let mut planes = BTreeSet::new();
            for layer in &frame.layers {
                if !matches!(layer.plane.as_str(), "background" | "body" | "foreground") || !planes.insert(&layer.plane)
                    || !bounded_anchor(layer.anchor) || layer.layout_anchors.iter().any(|(layout, anchor)|
                        !matches!(layout.as_str(), "65" | "108") || !bounded_anchor(*anchor)) {
                    return Err(invalid("Invalid layer plane, duplicate plane, or anchor"));
                }
                if !files.contains_key(&layer.asset) {
                    if files.len() >= MAX_ASSETS { return Err(error("LIMIT_EXCEEDED", "Too many assets")); }
                    let data = read_bounded(&asset_path(&root, &layer.asset)?, MAX_PACKAGE - total_bytes)?;
                    total_bytes += data.len() as u64;
                    let (width, height) = decode_png(&data)?;
                    total_pixels += u64::from(width) * u64::from(height);
                    if total_pixels > MAX_PIXELS { return Err(error("LIMIT_EXCEEDED", "Too many decoded pixels")); }
                    dimensions.insert(layer.asset.clone(), (width, height));
                    files.insert(layer.asset.clone(), data);
                }
                let (width, height) = dimensions[&layer.asset];
                let [x, y, w, h] = layer.rect;
                if w == 0 || h == 0 || u64::from(x) + u64::from(w) > u64::from(width)
                    || u64::from(y) + u64::from(h) > u64::from(height) {
                    return Err(invalid(format!("Frame outside PNG: {}", layer.asset)));
                }
            }
        }
    }
    for outfit in &m.outfits {
        let Some(sprites) = &outfit.body_sprites else { continue; };
        if sprites.profile != "dafeiyu-body-v1" {
            return Err(invalid("Unknown bodySprites profile"));
        }
        let mut paths = BTreeSet::new();
        for (path, expected) in [(&sprites.idle, "idle"), (&sprites.blink, "blink"),
            (&sprites.shy, "shy"), (&sprites.happy, "happy2")] {
            if path != &format!("assets/{}/notail_{expected}.png", outfit.id) || !paths.insert(path) {
                return Err(invalid("dafeiyu-body-v1 requires assets/<outfit-id>/notail_{idle,blink,shy,happy2}.png"));
            }
            let data = files.get(path).ok_or_else(|| invalid("Each body sprite must be referenced by an animation layer"))?;
            if dimensions.get(path) != Some(&(224, 278)) || data.get(25) != Some(&6) {
                return Err(invalid("dafeiyu-body-v1 sprites must be 224x278 8-bit RGBA PNG"));
            }
        }
    }
    // Hash canonical manifest and exact validated bytes, not source paths or modification times.
    files.insert("character.json".into(), canonical_manifest);
    let mut hash = Sha256::new();
    for (name, data) in &files {
        hash.update((name.len() as u64).to_le_bytes()); hash.update(name.as_bytes());
        hash.update((data.len() as u64).to_le_bytes()); hash.update(data);
    }
    let revision = hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(Package { manifest: m, files, revision })
}
fn bounded_anchor(anchor: [i32; 2]) -> bool { anchor.into_iter().all(|n| (-4096..=4096).contains(&n)) }
fn decode_png(data: &[u8]) -> Result<(u32, u32)> {
    let mut decoder = png::Decoder::new_with_limits(Cursor::new(data), png::Limits { bytes: 64 * 1024 * 1024 });
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    let mut reader = decoder.read_info().map_err(|e| error("INVALID_PNG", e.to_string()))?;
    let info = reader.info();
    let (width, height) = (info.width, info.height);
    if width == 0 || height == 0 || width > 4096 || height > 4096
        || info.bit_depth != png::BitDepth::Eight
        || !matches!(info.color_type, png::ColorType::Rgb | png::ColorType::Rgba)
        || info.animation_control.is_some() {
        return Err(error("INVALID_PNG", "Expected static 8-bit RGB/RGBA PNG up to 4096 per side"));
    }
    let size = reader.output_buffer_size().ok_or_else(|| error("LIMIT_EXCEEDED", "PNG output overflow"))?;
    if size > 64 * 1024 * 1024 { return Err(error("LIMIT_EXCEEDED", "PNG output too large")); }
    reader.next_frame(&mut vec![0; size]).map_err(|e| error("INVALID_PNG", e.to_string()))?;
    reader.finish().map_err(|e| error("INVALID_PNG", e.to_string()))?;
    Ok((width, height))
}
pub fn validate(path: &Path) -> Result<Value> {
    validate_with_manifest(path, None)
}
fn validate_with_manifest(path: &Path, manifest: Option<&Value>) -> Result<Value> {
    let package = inspect_with_manifest(path, manifest)?;
    let conflict = crate::cats::catalog_contains_id(&crate::config::app_data_dir(), &package.manifest.id)
        .map_err(|e| error("INVALID_CAT_CATALOG", e))?;
    if conflict { return Err(error("ID_CONFLICT", "ID belongs to an existing cat")); }
    Ok(json!({"valid":true, "id":package.manifest.id, "revision":package.revision,
        "outfits":package.manifest.outfits, "assets":package.files.len()-1,
        "warnings":["Validation covers format and PNG data, not visual quality or character accuracy."]}))
}

fn create_plain_dir(path: &Path) -> Result<()> {
    // Check existing ancestors before creation as well as the resulting directory.
    if let Some(existing) = path.ancestors().find(|p| p.exists()) { check_plain_path(existing)?; }
    std::fs::create_dir_all(path).map_err(io_error)?;
    check_plain_path(path)
}
fn write_new(path: &Path, data: &[u8]) -> Result<()> {
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(io_error)?;
    file.write_all(data).map_err(io_error)?;
    file.sync_all().map_err(io_error)
}
pub(crate) fn acquire_lock_at(root: &Path) -> Result<std::fs::File> {
    let lock=open_catalog_lock(root)?;
    lock.try_lock().map_err(|e| error("IMPORT_BUSY", e.to_string()))?;
    Ok(lock)
}
pub(crate) fn acquire_settings_lock_at(root:&Path)->Result<std::fs::File> {
    let lock=open_catalog_lock(root)?;
    lock.lock().map_err(io_error)?;
    Ok(lock)
}
fn open_catalog_lock(root:&Path)->Result<std::fs::File> {
    // Legacy cat catalogs may live below a redirected user profile. Import checks its own root.
    std::fs::create_dir_all(root).map_err(io_error)?;
    // OS-owned lock releases automatically on process exit; keep file for subsequent writers.
    let lock_path = root.join("character-import.lock");
    match std::fs::symlink_metadata(&lock_path) {
        Ok(metadata) if metadata.file_type().is_symlink() =>
            return Err(error("UNSAFE_PATH", "Lock file must not be a symbolic link")),
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(io_error(e)),
        _ => {},
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    reject_final_reparse_point(&mut options);
    let lock = options.open(lock_path).map_err(io_error)?;
    check_regular_handle(&lock)?;
    Ok(lock)
}
pub fn import(path: &Path, replace: bool) -> Result<Value> {
    import_with_manifest(path, replace, None)
}
fn import_with_manifest(path: &Path, replace: bool, manifest: Option<&Value>) -> Result<Value> {
    publish(inspect_with_manifest(path, manifest)?, replace, &crate::config::app_data_dir())
}
fn import_into(path: &Path, replace: bool, root: &Path) -> Result<Value> {
    publish(inspect(path)?, replace, root)
}
fn publish(package: Package, replace: bool, root: &Path) -> Result<Value> {
    create_plain_dir(root)?;
    let _lock = acquire_lock_at(root)?;
    let temp = root.join("characters.next.json");
    match std::fs::symlink_metadata(&temp) {
        Ok(_) => return Err(error("RECOVERY_REQUIRED", "characters.next.json exists; inspect it before retrying")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
        Err(e) => return Err(io_error(e)),
    }
    let mut registry = load_registry_at(root)?;
    let id = &package.manifest.id;
    if crate::cats::catalog_contains_id(root, id).map_err(|e| error("INVALID_CAT_CATALOG", e))? || (!replace && registry.characters.contains_key(id)) {
        return Err(error("ID_CONFLICT", "ID already exists; replace=true updates only character packages"));
    }
    if !registry.characters.contains_key(id) && registry.characters.len() >= 256 {
        return Err(error("LIMIT_EXCEEDED", "Registry full"));
    }
    let next_generation = registry.generation.checked_add(1).ok_or_else(|| error("LIMIT_EXCEEDED", "Generation overflow"))?;
    let entry = Entry {
        id: id.clone(), revision: package.revision.clone(), name: package.manifest.name.clone(),
        version: package.manifest.version.clone(),
        outfits: package.manifest.outfits.iter().map(|o| o.id.clone()).collect(),
        playable_outfits: package.manifest.outfits.iter().filter(|o| o.motion2d.is_some() && o.body_sprites.is_some()).map(|o| o.id.clone()).collect(),
        default_outfit_id: Some(package.manifest.default_outfit_id.clone()),
    };
    let revision_registered=registry.characters.get(id).is_some_and(|old|old.revision==package.revision);
    registry.characters.insert(id.clone(), entry.clone());
    registry.generation = next_generation;
    let candidate = serde_json::to_vec_pretty(&registry).map_err(|e| invalid(e.to_string()))?;
    if candidate.len() as u64 > MAX_REGISTRY {
        return Err(error("LIMIT_EXCEEDED", "Serialized registry exceeds size limit"));
    }
    let revision_dir = root.join("characters").join(id).join(&package.revision);
    // The registry is the publication boundary: resource readers accept only its current
    // revisions. Complete an unregistered content directory under the catalog lock, then
    // atomically commit the registry. No populated-directory rename is required on Windows.
    // Registered revisions stay immutable; an interrupted, unregistered write may resume
    // only when every existing referenced byte already matches the validated snapshot.
    if revision_registered && !revision_dir.is_dir() {
        return Err(error("INVALID_REGISTRY", "Registered revision directory is missing"));
    }
    create_plain_dir(&revision_dir)?;
    let mut missing=Vec::new();
    for (name,data) in &package.files {
        let target=revision_dir.join(name);
        match std::fs::symlink_metadata(&target) {
            Ok(_)=>if read_bounded(&target,MAX_PACKAGE)?!=*data {
                return Err(error("INVALID_REGISTRY","Existing revision content is damaged"));
            },
            Err(e) if e.kind()==std::io::ErrorKind::NotFound && !revision_registered=>missing.push((target,data)),
            Err(e)=>return Err(io_error(e)),
        }
    }
    for (target,data) in missing {
        if let Some(parent)=target.parent(){create_plain_dir(parent)?;}
        write_new(&target,data)?;
    }
    // Fixed temp name is safe under the OS lock; preserve failed temp files for diagnosis.
    write_new(&temp, &candidate)?;
    std::fs::rename(&temp, root.join("characters.json")).map_err(io_error)?;
    Ok(json!({"status":"imported", "entry":entry, "generation":registry.generation,
        "activated":false, "activationSupported":!entry.playable_outfits.is_empty()}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_cannot_escape_or_use_windows_streams() {
        for name in ["../secret.png", "assets/../a.png", "assets/a.png:stream", "assets/con.png", "https://x/a.png", "assets/a/b/c.png"] {
            assert!(asset_path(Path::new("unused"), name).is_err());
        }
    }
    #[test]
    fn png_decoder_rejects_truncated_data() { assert!(decode_png(b"\x89PNG\r\n\x1a\n").is_err()); }

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir().join(format!("kurocat-package-test-{}-{nonce}", std::process::id()));
            std::fs::create_dir(&path).unwrap();
            std::fs::create_dir(path.join("assets")).unwrap();
            let file = std::fs::File::create(path.join("assets/body.png")).unwrap();
            let mut encoder = png::Encoder::new(file, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[100, 120, 140, 255]).unwrap();
            writer.finish().unwrap();
            let fixture = Self(path);
            fixture.write(schema_guide()["genericExample"].clone());
            fixture
        }
        fn body_profile() -> Self {
            let fixture = Fixture::new();
            let example = schema_guide()["example"].clone();
            std::fs::create_dir(fixture.0.join("assets/default")).unwrap();
            for role in ["idle", "blink", "shy", "happy"] {
                let path = example["outfits"][0]["bodySprites"][role].as_str().unwrap();
                let file = std::fs::File::create(fixture.0.join(path)).unwrap();
                let mut encoder = png::Encoder::new(file, 224, 278);
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                let mut writer = encoder.write_header().unwrap();
                writer.write_image_data(&vec![0; 224 * 278 * 4]).unwrap();
                writer.finish().unwrap();
            }
            fixture.write(example);
            fixture
        }
        fn write(&self, value: Value) {
            std::fs::write(self.0.join("character.json"), serde_json::to_vec(&value).unwrap()).unwrap();
        }
    }
    // Retain generated fixtures and failed publication candidates for inspection.
    #[test]
    fn validation_checks_real_png_and_content_revision() {
        let fixture = Fixture::new();
        let first = inspect(&fixture.0).unwrap();
        assert_eq!(first.files.len(), 2);
        assert_eq!(first.revision, inspect(&fixture.0).unwrap().revision);
        let mut value = schema_guide()["genericExample"].clone();
        value["name"] = json!("Changed");
        fixture.write(value);
        assert_ne!(first.revision, inspect(&fixture.0).unwrap().revision);
    }
    #[test]
    fn missing_state_and_out_of_bounds_frames_are_rejected() {
        let fixture = Fixture::new();
        let mut value = schema_guide()["genericExample"].clone();
        value["outfits"][0]["actions"].as_object_mut().unwrap().remove("privacy");
        fixture.write(value);
        assert_eq!(inspect(&fixture.0).err().unwrap().code, "INVALID_MANIFEST");
        let mut value = schema_guide()["genericExample"].clone();
        value["animations"]["still"]["frames"][0]["layers"][0]["rect"] = json!([0,0,2,1]);
        fixture.write(value);
        assert_eq!(inspect(&fixture.0).err().unwrap().code, "INVALID_MANIFEST");
    }
    #[test]
    fn invalid_activation_source_is_rejected_before_writes() {
        let result = execute_tool("import_character_package", &json!({"path":"missing", "activate":true})).unwrap();
        assert_eq!(result.unwrap_err().code, "UNSAFE_PATH");
        assert_eq!(execute_tool("list_characters", &json!({"unexpected":true})).unwrap().unwrap_err().code, "INVALID_ARGUMENT");
    }
    #[test]
    fn import_conflict_update_and_failed_validation_preserve_registry() {
        let fixture = Fixture::new();
        let destination = fixture.0.join("installed");
        let first = import_into(&fixture.0, false, &destination).unwrap();
        assert_eq!(first["activated"], false);
        assert_eq!(load_registry_at(&destination).unwrap().generation, 1);
        assert_eq!(import_into(&fixture.0, false, &destination).unwrap_err().code, "ID_CONFLICT");
        let mut changed = schema_guide()["genericExample"].clone();
        changed["version"] = json!("2.0.0");
        fixture.write(changed);
        let second = import_into(&fixture.0, true, &destination).unwrap();
        assert_ne!(first["entry"]["revision"], second["entry"]["revision"]);
        assert_eq!(load_registry_at(&destination).unwrap().generation, 2);
        let previous = std::fs::read(destination.join("characters.json")).unwrap();
        std::fs::write(fixture.0.join("assets/body.png"), b"corrupt").unwrap();
        assert_eq!(import_into(&fixture.0, true, &destination).unwrap_err().code, "INVALID_PNG");
        assert_eq!(previous, std::fs::read(destination.join("characters.json")).unwrap());
    }
    #[test]
    fn failed_publication_keeps_old_registry_and_recovery_candidate() {
        let fixture = Fixture::new();
        let destination = fixture.0.join("installed");
        import_into(&fixture.0, false, &destination).unwrap();
        let previous = std::fs::read(destination.join("characters.json")).unwrap();
        std::fs::write(destination.join("characters.next.json"), b"previous failed candidate").unwrap();
        let mut changed = schema_guide()["genericExample"].clone();
        changed["version"] = json!("2.0.0");
        fixture.write(changed);
        let revision = inspect(&fixture.0).unwrap().revision;
        assert_eq!(import_into(&fixture.0, true, &destination).unwrap_err().code, "RECOVERY_REQUIRED");
        assert_eq!(previous, std::fs::read(destination.join("characters.json")).unwrap());
        assert!(!destination.join("characters/example-person").join(revision).exists());
    }
    #[test]
    fn damaged_registered_revision_recovers_through_new_inline_revision() {
        let fixture = Fixture::body_profile();
        let destination = fixture.0.join("installed");
        let first = import_into(&fixture.0, false, &destination).unwrap();
        crate::character_selection::choose_at(&destination, "example-person", None, true).unwrap();
        let selection = crate::character_selection::load_at(&destination).unwrap();
        let registry = std::fs::read(destination.join("characters.json")).unwrap();
        let mut manifest = schema_guide()["example"].clone();
        let asset = manifest["outfits"][0]["bodySprites"]["idle"].as_str().unwrap();
        let old_asset = destination.join("characters/example-person")
            .join(first["entry"]["revision"].as_str().unwrap()).join(asset);
        std::fs::write(&old_asset, b"damaged installed sprite").unwrap();
        assert_eq!(read_registered(&destination, "example-person").unwrap_err().code, "INVALID_PNG");
        assert_eq!(import_into(&fixture.0, true, &destination).unwrap_err().code, "INVALID_REGISTRY");
        assert_eq!(std::fs::read(destination.join("characters.json")).unwrap(), registry);
        assert_eq!(crate::character_selection::load_at(&destination).unwrap(), selection);

        manifest["version"] = json!("2.0.0");
        let expected_manifest = serde_json::to_value(serde_json::from_value::<Manifest>(manifest.clone()).unwrap()).unwrap();
        let recovered = publish(inspect_with_manifest(&fixture.0, Some(&manifest)).unwrap(), true, &destination).unwrap();
        assert_ne!(first["entry"]["revision"], recovered["entry"]["revision"]);
        crate::character_selection::choose_at(&destination, "example-person", None, true).unwrap();
        let healthy = read_registered(&destination, "example-person").unwrap();
        assert_eq!(healthy["integrityChecked"], true);
        assert_eq!(healthy["manifest"], expected_manifest);
        assert_eq!(crate::character_selection::load_at(&destination).unwrap(), selection);
        assert_eq!(std::fs::read(&old_asset).unwrap(), b"damaged installed sprite");
    }
    #[test]
    fn unregistered_partial_revision_keeps_old_package_readable_and_resumes() {
        let fixture=Fixture::new();let destination=fixture.0.join("installed");
        let first=import_into(&fixture.0,false,&destination).unwrap();
        let mut changed=schema_guide()["genericExample"].clone();changed["version"]=json!("2.0.0");fixture.write(changed);
        let package=inspect(&fixture.0).unwrap();let revision=package.revision.clone();
        let partial=destination.join("characters/example-person").join(&revision);
        let (name,bytes)=package.files.first_key_value().unwrap();let path=partial.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();std::fs::write(&path,bytes).unwrap();
        let untouched=std::fs::metadata(&path).unwrap().modified().unwrap();
        assert_eq!(read_registered(&destination,"example-person").unwrap()["entry"]["revision"],first["entry"]["revision"]);
        let result=publish(package,true,&destination).unwrap();assert_eq!(result["entry"]["revision"],revision);
        assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(),untouched);
        let read=read_registered(&destination,"example-person").unwrap();
        assert_eq!(read["manifest"]["version"],"2.0.0");assert_eq!(read["integrityChecked"],true);
    }
    #[test]
    fn mismatched_unregistered_partial_revision_is_not_overwritten_or_published() {
        let fixture=Fixture::new();let destination=fixture.0.join("installed");
        let package=inspect(&fixture.0).unwrap();let partial=destination.join("characters/example-person").join(&package.revision);
        let name=package.files.first_key_value().unwrap().0;let path=partial.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();std::fs::write(&path,b"retained corrupt bytes").unwrap();
        assert_eq!(read_registered(&destination,"example-person").unwrap_err().code,"CHARACTER_NOT_FOUND");
        assert_eq!(publish(package,false,&destination).unwrap_err().code,"INVALID_REGISTRY");
        assert_eq!(std::fs::read(&path).unwrap(),b"retained corrupt bytes");
        assert!(load_registry_at(&destination).unwrap().characters.is_empty());
        assert!(!destination.join("characters.json").exists());
    }
    #[test]
    fn corrupt_registry_is_not_treated_as_empty() {
        let fixture = Fixture::new();
        std::fs::write(fixture.0.join("characters.json"), b"{}").unwrap();
        assert_eq!(load_registry_at(&fixture.0).unwrap_err().code, "INVALID_REGISTRY");
    }
    #[test]
    fn concurrent_imports_publish_only_one_generation() {
        let fixture = Fixture::new();
        let destination = fixture.0.join("installed");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let workers: Vec<_> = (0..2).map(|_| {
            let barrier = barrier.clone();
            let source = fixture.0.clone();
            let target = destination.clone();
            std::thread::spawn(move || {
                barrier.wait();
                import_into(&source, false, &target)
            })
        }).collect();
        let results: Vec<_> = workers.into_iter().map(|w| w.join().unwrap()).collect();
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert!(results.iter().filter_map(|r| r.as_ref().err())
            .all(|e| matches!(e.code, "IMPORT_BUSY" | "ID_CONFLICT")));
        let registry = load_registry_at(&destination).unwrap();
        assert_eq!(registry.generation, 1);
        assert_eq!(registry.characters.len(), 1);
    }
    #[test]
    fn invalid_outfit_metadata_and_duplicate_manifest_fields_are_rejected() {
        let fixture = Fixture::new();
        let mut value = schema_guide()["genericExample"].clone();
        value["outfits"][0]["name"] = json!("Hidden\ncontrol");
        fixture.write(value);
        assert_eq!(inspect(&fixture.0).err().unwrap().code, "INVALID_MANIFEST");
        let serialized = serde_json::to_string(&schema_guide()["genericExample"]).unwrap();
        let duplicated = format!("{{\"name\":\"duplicate\",{}", &serialized[1..]);
        std::fs::write(fixture.0.join("character.json"), duplicated).unwrap();
        assert_eq!(inspect(&fixture.0).err().unwrap().code, "INVALID_MANIFEST");
    }
    #[test]
    fn generation_overflow_does_not_publish_an_orphan_revision() {
        let fixture = Fixture::new();
        let destination = fixture.0.join("installed");
        std::fs::create_dir(&destination).unwrap();
        std::fs::write(destination.join("characters.json"), serde_json::to_vec(&Registry {
            schema_version: 1, generation: u64::MAX, characters: BTreeMap::new(),
        }).unwrap()).unwrap();
        assert_eq!(import_into(&fixture.0, false, &destination).unwrap_err().code, "LIMIT_EXCEEDED");
        assert!(!destination.join("characters").exists());
        assert!(!destination.join("character-import-staging").exists());
    }
    #[test]
    fn damaged_registry_metadata_and_cat_catalog_prevent_publication() {
        let fixture = Fixture::new();
        let destination = fixture.0.join("installed");
        import_into(&fixture.0, false, &destination).unwrap();
        let path = destination.join("characters.json");
        let mut value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        value["characters"]["example-person"]["outfits"] = json!([]);
        let damaged = serde_json::to_vec(&value).unwrap();
        std::fs::write(&path, &damaged).unwrap();
        assert_eq!(import_into(&fixture.0, true, &destination).unwrap_err().code, "INVALID_REGISTRY");
        assert_eq!(std::fs::read(&path).unwrap(), damaged);

        let other = fixture.0.join("other-catalog");
        std::fs::create_dir(&other).unwrap();
        std::fs::write(other.join("cats.json"), b"damaged cats").unwrap();
        assert_eq!(import_into(&fixture.0, false, &other).unwrap_err().code, "INVALID_CAT_CATALOG");
        assert!(!other.join("characters").exists());
    }
    #[test]
    fn bigfish_body_profile_keeps_four_rgba_sprites_in_outfit_directory() {
        let fixture = Fixture::body_profile();
        let package = inspect(&fixture.0).unwrap();
        assert_eq!(package.files.len(), 5);
        let destination = fixture.0.join("installed");
        let result = import_into(&fixture.0, false, &destination).unwrap();
        let revision = result["entry"]["revision"].as_str().unwrap();
        assert!(destination.join("characters/example-person").join(revision)
            .join("assets/default/notail_happy2.png").is_file());
        // This generic fixture remains readable without the optional profile.
        let generic: Manifest = serde_json::from_value(schema_guide()["genericExample"].clone()).unwrap();
        assert!(generic.outfits[0].body_sprites.is_none());
    }
    #[test]
    fn inline_motion_import_and_verified_read_preserve_personality_without_source_changes() {
        let fixture = Fixture::body_profile();
        let source_before = std::fs::read(fixture.0.join("character.json")).unwrap();
        let original = fixture.0.join("original-character.json");
        std::fs::rename(fixture.0.join("character.json"), &original).unwrap();
        let destination = fixture.0.join("installed");
        let mut manifest = schema_guide()["example"].clone();
        manifest["assetNotice"] = json!("Original asset notice\nKept verbatim.");
        let calm: crate::motion2d::Motion2d = serde_json::from_str(include_str!("../protocol/calm-motion-2d.json")).unwrap();
        let calm = serde_json::to_value(calm).unwrap();
        manifest["outfits"][0]["motion2d"] = calm.clone();
        let package = inspect_with_manifest(&fixture.0, Some(&manifest)).unwrap();
        publish(package, false, &destination).unwrap();
        let read = read_registered(&destination, "example-person").unwrap();
        assert_eq!(read["manifest"]["outfits"][0]["motion2d"], calm);
        assert_eq!(read["manifest"]["assetNotice"], manifest["assetNotice"]);
        assert!(!fixture.0.join("character.json").exists());
        assert_eq!(source_before, std::fs::read(original).unwrap());
        // An unsafe update fails before publication; the previously stored personality survives.
        manifest["outfits"][0]["motion2d"]["privacy"]["clearInputOnExit"] = json!(false);
        assert_eq!(inspect_with_manifest(&fixture.0, Some(&manifest)).err().unwrap().code, "INVALID_MOTION");
        assert_eq!(read_registered(&destination, "example-person").unwrap()["manifest"]["outfits"][0]["motion2d"], calm);
        // A configuration-only update can use the verified installed PNGs as its read-only source.
        let installed=PathBuf::from(read["packagePath"].as_str().unwrap());
        let installed_before=std::fs::read(installed.join("character.json")).unwrap();
        let mut edited=read["manifest"].clone();
        edited["name"]=json!("Edited name");
        let update=inspect_with_manifest(&installed,Some(&edited)).unwrap();
        assert_ne!(update.revision,read["entry"]["revision"].as_str().unwrap());
        publish(update,true,&destination).unwrap();
        let updated=read_registered(&destination,"example-person").unwrap();
        assert_eq!(updated["manifest"],edited);
        assert_eq!(updated["manifest"]["outfits"][0]["motion2d"],calm);
        assert_ne!(updated["packagePath"],read["packagePath"]);
        assert_eq!(std::fs::read(installed.join("character.json")).unwrap(),installed_before);
    }
    #[test]
    fn builtin_reference_reuses_repo_pngs_and_preserves_asset_notice() {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src");
        let manifest = schema_guide()["dafeiyuReferencePackage"].clone();
        let package = inspect_with_manifest(&source, Some(&manifest)).unwrap();
        assert_eq!(package.files.len(), 5);
        assert!(package.manifest.asset_notice.unwrap().contains("Copyright (c) PC2005-cloud"));
    }
    #[test]
    fn procedural_selection_persists_and_invalid_outfit_preserves_previous_choice() {
        let fixture = Fixture::body_profile();
        let destination = fixture.0.join("installed");
        import_into(&fixture.0,false,&destination).unwrap();
        crate::character_selection::choose_at(&destination,"example-person",Some("default"),true).unwrap();
        let saved=crate::character_selection::load_at(&destination).unwrap();
        assert_eq!(saved.active_character_id.as_deref(),Some("example-person"));
        assert!(crate::character_selection::choose_at(&destination,"example-person",Some("missing"),true).is_err());
        assert_eq!(crate::character_selection::load_at(&destination).unwrap(),saved);
        crate::character_selection::clear_at(&destination).unwrap();
        let cleared=crate::character_selection::load_at(&destination).unwrap();
        assert!(cleared.active_character_id.is_none());
        assert_eq!(cleared.character_outfits.get("example-person").map(String::as_str),Some("default"));
    }
    #[test]
    fn frame_only_packages_cannot_activate() {
        let fixture=Fixture::new();let destination=fixture.0.join("installed");
        let result=import_into(&fixture.0,false,&destination).unwrap();
        assert_eq!(result["activationSupported"],false);
        let error=crate::character_selection::choose_at(&destination,"example-person",None,true).unwrap_err();
        assert_eq!(error.code,"ACTIVATION_UNAVAILABLE");
        assert!(crate::character_selection::load_at(&destination).unwrap().active_character_id.is_none());
    }
    #[test]
    fn bigfish_fixture_imports_two_variants_with_independent_motion() {
        let fixture = Fixture::new();
        let manifest: Value = serde_json::from_str(include_str!("../../scripts/fixtures/dafeiyu-package.json")).unwrap();
        for outfit in manifest["outfits"].as_array().unwrap() {
            for role in ["idle", "blink", "shy", "happy"] {
                let asset = outfit["bodySprites"][role].as_str().unwrap();
                let target = fixture.0.join(asset);
                std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/assets/dafeiyu")
                    .join(Path::new(asset).file_name().unwrap());
                std::fs::copy(source, target).unwrap();
            }
        }
        fixture.write(manifest);
        let package=inspect(&fixture.0).unwrap();assert_eq!(package.files.len(),9);
        assert_eq!(package.manifest.outfits.len(),2);
        assert_ne!(serde_json::to_value(&package.manifest.outfits[0].motion2d).unwrap(), serde_json::to_value(&package.manifest.outfits[1].motion2d).unwrap());
        let root=fixture.0.join("fixture-installed");
        publish(package,false,&root).unwrap();
        crate::character_selection::choose_at(&root,"motion-fixture",Some("primary"),true).unwrap();
        crate::character_selection::choose_at(&root,"motion-fixture",Some("alternate"),false).unwrap();
        let selected=crate::character_selection::load_at(&root).unwrap();
        assert_eq!(selected.active_character_id.as_deref(),Some("motion-fixture"));
        assert_eq!(selected.character_outfits.get("motion-fixture").map(String::as_str),Some("alternate"));
        let saved=read_registered(&root,"motion-fixture").unwrap();
        assert_eq!(saved["manifest"]["outfits"].as_array().unwrap().len(),2);
        assert!(saved["manifest"]["assetNotice"].as_str().unwrap().contains("MIT"));
    }
}

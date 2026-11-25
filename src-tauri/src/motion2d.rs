//! Data-only motion contract. This module never loads executable package code.
use crate::characters::{error, Result};
use serde_json::Value;
pub use crate::motion2d_types::Motion2d;

pub fn schema() -> Value {
    serde_json::from_str(include_str!("../protocol/motion-2d.schema.json"))
        .expect("bundled motion schema must be valid JSON")
}

pub fn reference() -> Value {
    serde_json::from_str(include_str!("../protocol/dafeiyu-motion-2d.json"))
        .expect("bundled motion reference must be valid JSON")
}

fn invalid(path: &str, message: &str) -> crate::characters::PackageError {
    error("INVALID_MOTION", format!("{path}: {message}"))
}

// Only traverses the fixed, bundled schema's finite subset. Packages cannot supply a schema,
// remote reference, expression, callback or script. Rust/TS types are generated from this file.
fn check(value: &Value, rule: &Value, root: &Value, path: &str) -> Result<()> {
    if let Some(reference) = rule.get("$ref").and_then(Value::as_str) {
        let target = reference.strip_prefix('#').and_then(|p| root.pointer(p))
            .expect("bundled schema reference must resolve locally");
        return check(value, target, root, path);
    }
    if let Some(expected) = rule.get("const") {
        if value != expected { return Err(invalid(path, "required invariant differs")); }
    }
    if let Some(choices) = rule.get("enum").and_then(Value::as_array) {
        if !choices.contains(value) { return Err(invalid(path, "unknown value")); }
    }
    match rule.get("type").and_then(Value::as_str) {
        Some("object") => {
            let object = value.as_object().ok_or_else(|| invalid(path, "expected object"))?;
            let properties = rule["properties"].as_object().expect("bundled properties");
            for key in rule["required"].as_array().expect("bundled required fields") {
                let key = key.as_str().expect("bundled field name");
                if !object.contains_key(key) { return Err(invalid(path, &format!("missing {key}"))); }
            }
            for (key, field) in object {
                let property = properties.get(key).ok_or_else(|| invalid(path, &format!("unknown field {key}")))?;
                check(field, property, root, &format!("{path}.{key}"))?;
            }
        }
        Some("array") => {
            let array = value.as_array().ok_or_else(|| invalid(path, "expected array"))?;
            let min = rule["minItems"].as_u64().expect("bundled array minimum") as usize;
            let max = rule["maxItems"].as_u64().expect("bundled array maximum") as usize;
            if array.len() < min || array.len() > max { return Err(invalid(path, "array length outside limits")); }
            for (index, item) in array.iter().enumerate() {
                check(item, &rule["items"], root, &format!("{path}[{index}]"))?;
            }
        }
        Some("number") | Some("integer") => {
            let n = value.as_f64().filter(|n| n.is_finite()).ok_or_else(|| invalid(path, "expected finite number"))?;
            if rule["type"] == "integer" && value.as_u64().is_none() {
                return Err(invalid(path, "expected unsigned integer"));
            }
            if rule.get("minimum").and_then(Value::as_f64).is_some_and(|min| n < min)
                || rule.get("maximum").and_then(Value::as_f64).is_some_and(|max| n > max) {
                return Err(invalid(path, "number outside limits"));
            }
        }
        Some("boolean") if !value.is_boolean() => return Err(invalid(path, "expected boolean")),
        Some("string") => {
            let s = value.as_str().ok_or_else(|| invalid(path, "expected string"))?;
            let valid = match rule.get("format").and_then(Value::as_str) {
                Some("hex-color") => s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit()),
                Some("slug") => crate::characters::valid_id(s),
                Some("logical-key") => !s.is_empty() && s.len() <= 24
                    && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'),
                _ => true,
            };
            if !valid { return Err(invalid(path, "invalid string format")); }
        }
        _ => {}
    }
    Ok(())
}

pub fn validate(m: &Motion2d) -> Result<()> {
    let value = serde_json::to_value(m).map_err(|e| invalid("motion2d", &e.to_string()))?;
    let root = schema();
    check(&value, &root, &root, "motion2d")?;
    for (path, range) in [("blink.firstDelayMs", m.blink.first_delay_ms), ("blink.intervalMs", m.blink.interval_ms)] {
        if range[0] > range[1] { return Err(invalid(path, "minimum must not exceed maximum")); }
    }
    if m.petting.step_distance_px[0] >= m.petting.step_distance_px[1] {
        return Err(invalid("petting.stepDistancePx", "minimum must be below maximum"));
    }
    for (path, range) in [("gaze.horizontalRangePx", m.gaze.horizontal_range_px),
        ("gaze.verticalRangePx", m.gaze.vertical_range_px)] {
        if range[0] > range[1] { return Err(invalid(path, "minimum must not exceed maximum")); }
    }
    if m.mood.rise_thresholds[0] >= m.mood.rise_thresholds[1]
        || m.mood.fall_thresholds[0] >= m.mood.fall_thresholds[1]
        || (0..2).any(|i| m.mood.fall_thresholds[i] >= m.mood.rise_thresholds[i]) {
        return Err(invalid("mood", "hysteresis thresholds are inconsistent"));
    }
    if !m.tail.enabled && m.bindings.tail_mode != "off" {
        return Err(invalid("bindings.tailMode", "disabled tail requires off"));
    }
    for stops in [&m.gaze.iris_gradient, &m.gaze.sclera_gradient, &m.hands.style.sleeve_gradient,
        &m.tail.stem_gradient, &m.tail.fluke_gradient] {
        if stops.first().map(|s| s.offset) != Some(0.0) || stops.last().map(|s| s.offset) != Some(1.0)
            || stops.windows(2).any(|p| p[0].offset > p[1].offset) {
            return Err(invalid("gradient", "stops must be ordered and span 0..1"));
        }
    }
    let [width, height] = m.rig.source_size.map(f64::from);
    let in_source = |p: &[f64; 2]| p[0] >= 0.0 && p[0] <= width && p[1] >= 0.0 && p[1] <= height;
    for eye in &m.rig.eyes {
        if !in_source(&eye.center) || eye.clip.iter().any(|p| !in_source(p))
            || eye.center[0] - eye.radius[0] < 0.0 || eye.center[0] + eye.radius[0] > width
            || eye.center[1] - eye.radius[1] < 0.0 || eye.center[1] + eye.radius[1] > height {
            return Err(invalid("rig.eyes", "eye geometry escapes source image"));
        }
    }
    for rect in std::iter::once(&m.rig.hair_occlusion.crop).chain(m.rig.hair_occlusion.regions.iter()) {
        if rect[2] <= 0.0 || rect[3] <= 0.0 || rect[0] + rect[2] > width || rect[1] + rect[3] > height {
            return Err(invalid("rig.hairOcclusion", "rectangle escapes source image"));
        }
    }
    for layout in [&m.layouts.compact, &m.layouts.full] {
        let [w, h] = layout.logical_size.map(f64::from);
        for p in [&layout.body_center, &layout.keyboard_center, &layout.mouse_base] {
            if p[0] < 0.0 || p[0] > w || p[1] < 0.0 || p[1] > h {
                return Err(invalid("layouts", "anchor escapes layout canvas"));
            }
        }
        if layout.draw_width > w || layout.keyboard_size[0] > w || layout.keyboard_size[1] > h {
            return Err(invalid("layouts", "geometry exceeds layout canvas"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn assert_same_json_value(actual:&Value,expected:&Value) {
        match (actual,expected) {
            // Typed f64 fields may serialize an original JSON integer as 12.0.
            (Value::Number(a),Value::Number(b))=>assert_eq!(a.as_f64(),b.as_f64()),
            (Value::Array(a),Value::Array(b))=>{
                assert_eq!(a.len(),b.len());
                for (actual,expected) in a.iter().zip(b){assert_same_json_value(actual,expected);}
            },
            (Value::Object(a),Value::Object(b))=>{
                assert_eq!(a.keys().collect::<Vec<_>>(),b.keys().collect::<Vec<_>>());
                for (key,value) in a{assert_same_json_value(value,&b[key]);}
            },
            _=>assert_eq!(actual,expected),
        }
    }
    #[test]
    fn reference_and_distinct_personality_round_trip() {
        let lively: Motion2d = serde_json::from_value(reference()).unwrap();
        let calm: Motion2d = serde_json::from_str(include_str!("../protocol/calm-motion-2d.json")).unwrap();
        validate(&lively).unwrap(); validate(&calm).unwrap();
        assert_ne!(lively.personality.pet_reactions[0].motion, calm.personality.pet_reactions[0].motion);
        assert_ne!(lively.petting.required_reversals, calm.petting.required_reversals);
        let saved = serde_json::to_value(&calm).unwrap();
        assert_eq!(saved, serde_json::to_value(serde_json::from_value::<Motion2d>(saved.clone()).unwrap()).unwrap());
    }
    #[test]
    fn unsafe_privacy_invalid_hysteresis_and_rig_are_rejected() {
        let mut m: Motion2d = serde_json::from_value(reference()).unwrap();
        m.privacy.clear_input_on_exit = false; assert!(validate(&m).is_err());
        m.privacy.clear_input_on_exit = true;
        m.mood.fall_thresholds[0] = 0.9; assert!(validate(&m).is_err());
        m.mood.fall_thresholds[0] = 0.22;
        m.rig.eyes[0].center[0] = 300.0; assert!(validate(&m).is_err());
    }
    #[test]
    fn optional_cuff_style_preserves_old_json_and_checks_new_values() {
        let source=reference();let mut m:Motion2d=serde_json::from_value(source.clone()).unwrap();
        assert!(m.hands.style.cuff_style.is_none());
        assert_same_json_value(&serde_json::to_value(&m).unwrap(),&source);
        m.hands.style.cuff_style=Some("plain".into());validate(&m).unwrap();
        m.hands.style.cuff_style=Some("ribbed".into());validate(&m).unwrap();
        m.hands.style.cuff_style=Some("script".into());assert!(validate(&m).is_err());
    }
}

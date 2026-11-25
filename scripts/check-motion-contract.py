"""Static contract checks only: no Rust compilation, package installation or app data writes."""
import copy
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "src-tauri/protocol/motion-2d.schema.json").read_text(encoding="utf-8"))


def require(condition, path):
    if not condition:
        raise ValueError(path)


def check(value, spec=SCHEMA, path="motion2d"):
    if "$ref" in spec:
        return check(value, SCHEMA["$defs"][spec["$ref"].removeprefix("#/$defs/")], path)
    if "const" in spec:
        require(value == spec["const"], path)
    if "enum" in spec:
        require(value in spec["enum"], path)
    kind = spec["type"]
    if kind == "object":
        require(type(value) is dict and set(spec["required"]) <= set(value) <= set(spec["properties"]), path)
        for key, child in value.items():
            check(child, spec["properties"][key], path + "." + key)
    elif kind == "array":
        require(type(value) is list and spec["minItems"] <= len(value) <= spec["maxItems"], path)
        for i, child in enumerate(value):
            check(child, spec["items"], f"{path}[{i}]")
    elif kind in ("number", "integer"):
        require(type(value) in ((int,) if kind == "integer" else (int, float)) and math.isfinite(value), path)
        require(value >= spec.get("minimum", -math.inf) and value <= spec.get("maximum", math.inf), path)
    elif kind == "boolean":
        require(type(value) is bool, path)
    elif kind == "string":
        require(type(value) is str, path)
        fmt = spec.get("format")
        if fmt == "hex-color":
            require(re.fullmatch(r"#[0-9a-fA-F]{6}", value), path)
        elif fmt == "logical-key":
            require(re.fullmatch(r"[a-z0-9_]{1,24}", value), path)
        elif fmt == "slug":
            require(re.fullmatch(r"[a-z][a-z0-9-]{0,47}", value), path)
            require(value not in {"con", "prn", "aux", "nul"} and not re.fullmatch(r"(?:com|lpt)[1-9]", value), path)


def check_relations(m):
    for interval in [m["blink"]["firstDelayMs"], m["blink"]["intervalMs"],
                     m["gaze"]["horizontalRangePx"], m["gaze"]["verticalRangePx"]]:
        require(interval[0] <= interval[1], "interval")
    require(m["petting"]["stepDistancePx"][0] < m["petting"]["stepDistancePx"][1], "pet step")
    rise, fall = m["mood"]["riseThresholds"], m["mood"]["fallThresholds"]
    require(rise[0] < rise[1] and fall[0] < fall[1] and all(f < r for f, r in zip(fall, rise)), "hysteresis")
    require(m["tail"]["enabled"] or m["bindings"]["tailMode"] == "off", "tail mode")
    gradients = [m["gaze"]["irisGradient"], m["gaze"]["scleraGradient"],
                 m["hands"]["style"]["sleeveGradient"], m["tail"]["stemGradient"], m["tail"]["flukeGradient"]]
    for stops in gradients:
        offsets = [s["offset"] for s in stops]
        require(offsets[0] == 0 and offsets[-1] == 1 and offsets == sorted(offsets), "gradient")
    width, height = m["rig"]["sourceSize"]
    for eye in m["rig"]["eyes"]:
        require(all(0 <= x <= width and 0 <= y <= height for x, y in eye["clip"]), "eye clip")
        (x, y), (rx, ry) = eye["center"], eye["radius"]
        require(0 <= x - rx <= x + rx <= width and 0 <= y - ry <= y + ry <= height, "eye radius")
    hair = m["rig"]["hairOcclusion"]
    for x, y, w, h in [hair["crop"], *hair["regions"]]:
        require(w > 0 and h > 0 and x + w <= width and y + h <= height, "hair rectangle")
    for layout in m["layouts"].values():
        w, h = layout["logicalSize"]
        require(all(0 <= x <= w and 0 <= y <= h for x, y in
                    [layout["bodyCenter"], layout["keyboardCenter"], layout["mouseBase"]]), "layout anchor")
        require(layout["drawWidth"] <= w and layout["keyboardSize"][0] <= w and layout["keyboardSize"][1] <= h, "layout size")


def validate(m):
    check(m)
    check_relations(m)


if __name__ == "__main__":
    import runpy
    generator = runpy.run_path(str(ROOT / "scripts/generate-motion-types.py"))
    for path, expected in generator["generate"]().items():
        require(path.read_text(encoding="utf-8") == expected, str(path))
    samples = [json.loads((ROOT / f"src-tauri/protocol/{name}-motion-2d.json").read_text(encoding="utf-8"))
               for name in ["dafeiyu", "calm"]]
    for sample in samples:
        validate(sample)
        require(json.loads(json.dumps(sample)) == sample, "JSON round trip")
    mutations = [
        ("unsafe privacy", lambda m: m["privacy"].update(clearInputOnExit=False)),
        ("raw keys", lambda m: m["sync"].update(storeRawKeys=True)),
        ("script injection", lambda m: m.update(script="run()")),
        ("invalid hysteresis", lambda m: m["mood"].update(fallThresholds=[.9,.95])),
        ("out of bounds eye", lambda m: m["rig"]["eyes"][0].update(center=[999,0])),
        ("invalid interval", lambda m: m["blink"].update(intervalMs=[9000,1000])),
        ("invalid gradient", lambda m: m["gaze"]["irisGradient"][0].update(offset=.5)),
        ("nonfinite motion", lambda m: m["body"].update(breathAmplitudePx=float("nan"))),
        ("disabled tail", lambda m: m["tail"].update(enabled=False)),
        ("unknown gesture", lambda m: m["personality"]["petReactions"][0].update(motion="eval")),
        ("unknown cuff style", lambda m: m["hands"]["style"].update(cuffStyle="script")),
    ]
    for name, change in mutations:
        m = copy.deepcopy(samples[0]); change(m)
        try:
            validate(m)
        except ValueError:
            continue
        raise AssertionError(f"Accepted invalid fixture: {name}")
    require(samples[0]["personality"] != samples[1]["personality"], "gesture diversity")
    require(samples[0]["petting"] != samples[1]["petting"], "interaction diversity")
    print(f"Static checks passed: 2 reference/personality fixtures, {len(mutations)} negative cases, JSON round trips and generated type consistency. Rust/MCP runtime not executed.")

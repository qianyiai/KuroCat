"""Generic BigFish fixture checks; does not replace the Rust importer or write AppData."""
import json
import runpy
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "scripts/fixtures"
motion_check = runpy.run_path(str(ROOT / "scripts/check-motion-contract.py"))["validate"]


def require(value, message):
    if not value:
        raise ValueError(message)


def png_header(path):
    raw = path.read_bytes()
    require(raw[:8] == b"\x89PNG\r\n\x1a\n", "PNG signature")
    offset, ended = 8, False
    while offset < len(raw):
        size = struct.unpack_from(">I", raw, offset)[0]
        kind, content = raw[offset + 4:offset + 8], raw[offset + 8:offset + 8 + size]
        require(offset + 12 + size <= len(raw), "Truncated PNG chunk")
        crc = struct.unpack_from(">I", raw, offset + 8 + size)[0]
        require(zlib.crc32(kind + content) & 0xFFFFFFFF == crc, "PNG CRC")
        require(kind != b"acTL", "Animated PNG not allowed")
        offset += size + 12
        if kind == b"IEND":
            ended = True
            break
    require(ended and offset == len(raw), "PNG end/trailing data")
    require(struct.unpack(">II", raw[16:24]) == (224, 278) and raw[24:26] == bytes([8, 6]), "RGBA profile")


if __name__ == "__main__":
    manifest = json.loads((PACKAGE / "dafeiyu-package.json").read_text(encoding="utf-8"))
    require(manifest["id"] == "motion-fixture" and manifest["schemaVersion"] == 1, "Fixture identity")
    require(manifest["defaultOutfitId"] == "primary", "Default outfit")
    require({outfit["id"] for outfit in manifest["outfits"]} == {"primary", "alternate"}, "Two outfits, one character")
    require(manifest["license"] == "MIT" and "MIT" in manifest["assetNotice"], "Existing BigFish provenance")
    assets = set()
    for outfit in manifest["outfits"]:
        motion_check(outfit["motion2d"])
        require(not outfit["motion2d"]["tail"]["enabled"] and outfit["motion2d"]["bindings"]["tailMode"] == "off", "No whale tail")
        require(set(outfit["actions"]) == {"idle", "typing", "mouse", "interaction", "rest", "privacy"}, "Required actions")
        profile = outfit["bodySprites"]
        require(profile["profile"] == "dafeiyu-body-v1", "Body profile")
        for role in ["idle", "blink", "shy", "happy"]:
            asset = profile[role]
            require(asset.startswith(f"assets/{outfit['id']}/") and asset.endswith(".png"), "Outfit asset containment")
            path = (ROOT / "src/assets/dafeiyu" / Path(asset).name).resolve()
            require(path.is_relative_to((ROOT / "src/assets/dafeiyu").resolve()), "Path escape")
            png_header(path)
            assets.add(asset)
        for action, variants in outfit["actions"].items():
            for variant in variants:
                require(variant["animation"] in manifest["animations"], "Animation reference")
                if action == "privacy":
                    animation = manifest["animations"][variant["animation"]]
                    require(all(any(layer["asset"] == profile["blink"] for layer in frame["layers"]) for frame in animation["frames"]), "Privacy expression")
    referenced = {layer["asset"] for animation in manifest["animations"].values() for frame in animation["frames"] for layer in frame["layers"]}
    require(referenced == assets and len(assets) == 8, "Every body sprite referenced exactly by this package")
    print("Fixture static checks passed: test-only identity, two motion variants, eight CRC-checked RGBA PNGs, motion/appearance/privacy/provenance. Rust importer not executed.")

"""Source-level ownership audit only; does not compile Rust or execute persistence/locking."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src-tauri/src"


def arguments(text, start):
    depth, quote, escaped, count = 1, False, False, 1
    begin = start
    for i in range(start, len(text)):
        c = text[i]
        if quote:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == '"':
                quote = False
            continue
        if c == '"':
            quote = True
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return count, text[begin:i]
        elif c == "," and depth == 1:
            count += 1
    raise AssertionError("Unclosed settings call")


config = (SOURCE / "config.rs").read_text(encoding="utf-8")
settings = config.split("pub struct AppSettings {", 1)[1].split("\n}", 1)[0]
fields = set()
for name in re.findall(r"pub (\w+)\s*:", settings):
    first, *rest = name.split("_")
    fields.add(first + "".join(part.title() for part in rest))

calls = []
for path in SOURCE.glob("*.rs"):
    text = path.read_text(encoding="utf-8").split("#[cfg(test)]", 1)[0]
    for match in re.finditer(r"\b(?:try_save_cat_settings|try_save_settings|save_settings)\s*\(", text):
        if re.search(r"\bfn\s*$", text[max(0, match.start()-20):match.start()]):
            continue
        count, body = arguments(text, match.end())
        line = text.count("\n", 0, match.start()) + 1
        assert count == 2, f"Whole-snapshot/invalid settings write: {path.name}:{line}"
        literals = re.findall(r'"([A-Za-z][A-Za-z0-9]*)"', body)
        assert all(field in fields for field in literals), f"Unknown setting field: {path.name}:{line} {literals}"
        calls.append((path.name, line))
    if path.name != "config.rs":
        assert '"settings.json"' not in text, f"Direct settings path outside central persistence: {path.name}"

assert arguments('&mut s,if yes {&["x","y"]}else{&["x"]})', 0)[0] == 2
assert arguments('&s)', 0)[0] == 1
assert "acquire_settings_lock_at(root)" in config and "clear_locked_at(root)" in config
assert len(calls) >= 25, "Writer inventory unexpectedly incomplete"
print(f"Static writer audit passed: {len(calls)} explicit-field calls; field names match AppSettings; settings file ownership centralized. Rust/concurrency runtime not executed.")

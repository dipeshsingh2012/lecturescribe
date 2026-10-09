#!/usr/bin/env python3
"""
Package & Configure LectureScribe Browser Extension for Chrome & Firefox
------------------------------------------------------------------------
Builds browser-specific ZIP packages and allows switching local manifest:
  - Firefox MV3 uses: background.scripts: ["background/background.js"]
  - Chrome MV3 uses:  background.service_worker: "background/background.js"

Usage:
  python3 scripts/package_extension.py              # Build both distribution zips
  python3 scripts/package_extension.py --set chrome # Configure extension/manifest.json for Chrome
  python3 scripts/package_extension.py --set firefox# Configure extension/manifest.json for Firefox
"""

import sys
import zipfile
import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
EXT_DIR = ROOT_DIR / "extension"
DIST_DIR = ROOT_DIR / "extension" / "dist"
MANIFEST_PATH = EXT_DIR / "manifest.json"


def get_base_manifest():
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def set_active_manifest(target: str):
    data = get_base_manifest()
    if target == "firefox":
        data["background"] = {"scripts": ["background/background.js"]}
        print("🦊 Set extension/manifest.json background to background.scripts (Firefox)")
    elif target == "chrome":
        data["background"] = {"service_worker": "background/background.js"}
        print("🌐 Set extension/manifest.json background to background.service_worker (Chrome/Chromium)")
    else:
        print(f"Unknown target: {target}. Choose 'chrome' or 'firefox'.")
        sys.exit(1)

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def create_bundles():
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    base_data = get_base_manifest()
    version = base_data.get("version", "1.0.0")
    print(f"📦 Packaging LectureScribe Extension v{version}...")

    # Files to include (skip dist/, git, cache, and OS hidden files)
    files_to_pack = []
    for path in EXT_DIR.rglob("*"):
        if path.is_file():
            rel_path = path.relative_to(EXT_DIR)
            if "dist" in rel_path.parts or rel_path.name.startswith(".") or rel_path.name == "manifest.json":
                continue
            files_to_pack.append((path, rel_path))

    # 1. Chrome Bundle (with service_worker)
    chrome_manifest = dict(base_data)
    chrome_manifest["background"] = {"service_worker": "background/background.js"}
    chrome_zip = DIST_DIR / f"lecturescribe-v{version}-chrome.zip"
    with zipfile.ZipFile(chrome_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(chrome_manifest, indent=2) + "\n")
        for abs_p, rel_p in files_to_pack:
            zf.write(abs_p, rel_p)
    print(f"✅ Chrome archive:  {chrome_zip} ({chrome_zip.stat().st_size} bytes)")

    # 2. Firefox Bundle (with background.scripts)
    firefox_manifest = dict(base_data)
    firefox_manifest["background"] = {"scripts": ["background/background.js"]}
    firefox_zip = DIST_DIR / f"lecturescribe-v{version}-firefox.zip"
    with zipfile.ZipFile(firefox_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(firefox_manifest, indent=2) + "\n")
        for abs_p, rel_p in files_to_pack:
            zf.write(abs_p, rel_p)
    print(f"✅ Firefox archive: {firefox_zip} ({firefox_zip.stat().st_size} bytes)")

    print("\n🎉 Packaging complete! Both archives are ready in extension/dist/.")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--set":
        set_active_manifest(sys.argv[2].lower())
    else:
        create_bundles()

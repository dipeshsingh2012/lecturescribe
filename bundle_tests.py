import os

OUTPUT_FILE = "tests_bundle.txt"

# Folders to skip
IGNORED_DIRS = {
    ".git",
    ".idea",
    ".vscode",
    "node_modules",
    "venv",
    ".venv",
    "env",
    "dist",
    "build",
    "__pycache__",
    ".pytest_cache",
}

def is_test_file(path: str) -> bool:
    """Determine if a file is a Python or frontend test file."""
    filename = os.path.basename(path).lower()
    
    # Python pytest tests
    if filename.startswith("test_") and filename.endswith(".py"):
        return True
    if filename.endswith("_test.py"):
        return True
        
    # Frontend Vitest / Jest tests
    if any(filename.endswith(ext) for ext in [".test.js", ".test.jsx", ".test.ts", ".test.tsx"]):
        return True
        
    # Pytest configuration
    if filename in ["pytest.ini", "setupTests.js", "vitest.config.js"]:
        return True

    return False


def bundle_tests(root_dir="."):
    collected = []

    # 1. Discover all test files
    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
        for f in sorted(files):
            file_path = os.path.join(root, f)
            rel_path = os.path.relpath(file_path, root_dir)
            if is_test_file(rel_path):
                collected.append(rel_path)

    collected.sort()

    # 2. Write out bundled content
    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        out.write("=" * 80 + "\n")
        out.write(f"TEST SUITE FILES ({len(collected)} files found)\n")
        out.write("=" * 80 + "\n\n")

        for path in collected:
            out.write(f"- {path}\n")

        out.write("\n\n" + "=" * 80 + "\n")
        out.write("TEST FILE CONTENTS\n")
        out.write("=" * 80 + "\n\n")

        for path in collected:
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()

                out.write(f"--- START OF FILE: {path} ---\n")
                out.write(content)
                if not content.endswith("\n"):
                    out.write("\n")
                out.write(f"--- END OF FILE: {path} ---\n\n")
                print(f"Added: {path}")

            except Exception as e:
                print(f"Skipping {path} due to error: {e}")

    print(f"\nDone! Successfully bundled {len(collected)} test files into '{OUTPUT_FILE}'.")


if __name__ == "__main__":
    bundle_tests()
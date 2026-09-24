# LectureScribe

**LectureScribe** is a lightweight, zero-dependency Python tool to extract timestamped lecture transcripts and auto-generated captions directly from Vimeo URLs.

## Features

- ⚡ **Zero External Dependencies**: Uses Python standard library only (`urllib`, `json`, `re`, `pathlib`).
- ⏱️ **Timestamp Preservation**: Outputs formatted Markdown with clean `[MM:SS]` timestamps.
- 🎯 **Direct Stream Parsing**: Extracts captions directly via Vimeo's API metadata endpoints without requiring browser rendering or headless Chrome/Playwright.
- 📝 **Markdown Output**: Ready for note-taking apps like Obsidian, Notion, or LLM indexing.

## Quick Start

```bash
# Basic usage (auto-generates filename based on video title)
python3 lecturescribe.py https://vimeo.com/1229247139

# Custom output file
python3 lecturescribe.py https://vimeo.com/1229247139 --output lecture1.md

# Using raw Vimeo Video ID
python3 lecturescribe.py 1229247139
```

## Sample Output

```markdown
# Introduction to Research Live session -1 (22 / 9 / 2026)

**Source:** https://vimeo.com/1229247139
**Captions:** English (auto-generated)
**Segments:** 1351

---

**[06:29]** Good evening, all.

**[06:34]** Good evening, sir.

**[06:38]** Yeah. Hope I can- Good evening, sir. You can hear me?
```


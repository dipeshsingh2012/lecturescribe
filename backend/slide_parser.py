"""
Slide and Document Parser for LectureScribe
-------------------------------------------
Extracts structured text from professor slide decks (.pptx, .ppt, .pdf)
including titles, bullet points, table text, and speaker notes.
Operates on both file paths and raw bytes without vector chunking.
"""
from __future__ import annotations

import io
import re
from typing import List, Dict, Any, Optional, Union

try:
    import pptx
except ImportError:
    pptx = None

try:
    import pypdf
except ImportError:
    pypdf = None


def extract_text_from_pptx(source: Union[str, bytes]) -> List[Dict[str, Any]]:
    """
    Extract text per slide from a PowerPoint presentation (.pptx).
    Returns a list of dicts: [{'slide_number': int, 'title': str, 'text': str, 'notes': str}]
    """
    if not pptx:
        return []

    try:
        if isinstance(source, bytes):
            prs = pptx.Presentation(io.BytesIO(source))
        else:
            prs = pptx.Presentation(source)
    except Exception as e:
        print(f"[SlideParser Warning] Could not parse PPTX: {e}")
        return []

    results: List[Dict[str, Any]] = []

    for idx, slide in enumerate(prs.slides, start=1):
        slide_title = ""
        text_fragments: List[str] = []
        notes_text = ""

        # Check shapes in slide
        for shape in slide.shapes:
            if shape.has_text_frame:
                frame_text = "\n".join([p.text.strip() for p in shape.text_frame.paragraphs if p.text.strip()])
                if frame_text:
                    if shape == slide.shapes.title or (not slide_title and shape.name.lower().startswith("title")):
                        slide_title = frame_text.replace("\n", " ").strip()
                    text_fragments.append(frame_text)

            # Check tables
            if shape.has_table:
                for row in shape.table.rows:
                    row_cells = [c.text.strip() for c in row.cells if c.text.strip()]
                    if row_cells:
                        text_fragments.append(" | ".join(row_cells))

        # Check speaker notes
        try:
            if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
                notes_text = slide.notes_slide.notes_text_frame.text.strip()
        except Exception:
            pass

        full_slide_text = "\n".join(text_fragments).strip()
        if full_slide_text or notes_text:
            results.append({
                "slide_number": idx,
                "title": slide_title or f"Slide {idx}",
                "text": full_slide_text,
                "notes": notes_text
            })

    return results


def extract_text_from_pdf(source: Union[str, bytes]) -> List[Dict[str, Any]]:
    """
    Extract text per page from a PDF slide deck.
    Returns a list of dicts: [{'slide_number': int, 'title': str, 'text': str, 'notes': ''}]
    """
    if not pypdf:
        return []

    try:
        if isinstance(source, bytes):
            reader = pypdf.PdfReader(io.BytesIO(source))
        else:
            reader = pypdf.PdfReader(source)
    except Exception as e:
        print(f"[SlideParser Warning] Could not parse PDF: {e}")
        return []

    results: List[Dict[str, Any]] = []
    for idx, page in enumerate(reader.pages, start=1):
        try:
            raw_text = page.extract_text() or ""
            clean_text = raw_text.strip()
            if clean_text:
                first_line = clean_text.split("\n")[0][:100].strip()
                results.append({
                    "slide_number": idx,
                    "title": first_line or f"Slide {idx}",
                    "text": clean_text,
                    "notes": ""
                })
        except Exception:
            continue

    return results


def parse_slide_document(
    source: Union[str, bytes],
    filename: str = ""
) -> List[Dict[str, Any]]:
    """
    Auto-detect file extension and parse slide deck text.
    """
    fn = filename.lower()
    if fn.endswith(".pptx"):
        return extract_text_from_pptx(source)
    elif fn.endswith(".pdf"):
        return extract_text_from_pdf(source)
    else:
        # Try pptx first, then pdf
        res = extract_text_from_pptx(source)
        if not res:
            res = extract_text_from_pdf(source)
        return res


def format_slides_for_llm(slides_data: List[Dict[str, Any]], max_chars: int = 25000) -> str:
    """Format extracted slides into a compact text block for LLM prompt ingestion."""
    lines: List[str] = []
    total_len = 0
    for s in slides_data:
        block = f"[Slide {s['slide_number']}: {s['title']}]\n{s['text']}"
        if s.get("notes"):
            block += f"\n(Speaker Notes: {s['notes']})"
        if total_len + len(block) > max_chars:
            lines.append("... [Slide deck truncated for brevity]")
            break
        lines.append(block)
        total_len += len(block)
    return "\n\n".join(lines)

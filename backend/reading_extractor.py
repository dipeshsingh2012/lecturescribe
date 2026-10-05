"""
Academic Reading & Book Extractor for LectureScribe
---------------------------------------------------
Parses lecture transcripts and professor slide decks (.pptx / .pdf)
to extract recommended textbooks, reference books, eBooks, and journal articles.
Enriches items via Google Books API and provides fallback academic web search.
"""
from __future__ import annotations

import os
import re
import json
import urllib.parse
from typing import List, Dict, Any, Optional

import requests
from backend.web_search import search_web_for_context

GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1/volumes"


def fetch_google_books_metadata(title: str, author: str = "") -> Dict[str, Any]:
    """
    Query Google Books API (free, keyless) to retrieve official cover,
    preview URL, ISBN, and publication metadata.
    """
    if not title or len(title.strip()) < 3:
        return {}

    query_parts = [f'intitle:"{title.strip()}"']
    if author and len(author.strip()) >= 3:
        clean_author = re.sub(r'(?i)\bet al\.?\b', '', author).strip()
        query_parts.append(f'inauthor:"{clean_author}"')

    query = " ".join(query_parts)
    try:
        resp = requests.get(
            GOOGLE_BOOKS_API,
            params={"q": query, "maxResults": 1, "printType": "books"},
            timeout=4.0
        )
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("items", [])
            if items:
                vol = items[0].get("volumeInfo", {})
                img_links = vol.get("imageLinks", {})
                cover_url = img_links.get("thumbnail") or img_links.get("smallThumbnail") or ""
                if cover_url and cover_url.startswith("http://"):
                    cover_url = "https://" + cover_url[7:]

                preview_url = vol.get("previewLink") or vol.get("infoLink") or ""
                if preview_url and preview_url.startswith("http://"):
                    preview_url = "https://" + preview_url[7:]

                isbn = ""
                for ident in vol.get("industryIdentifiers", []):
                    if ident.get("type") in ("ISBN_13", "ISBN_10"):
                        isbn = ident.get("identifier", "")
                        break

                return {
                    "matched_title": vol.get("title", title),
                    "matched_authors": ", ".join(vol.get("authors", [])) or author,
                    "cover_url": cover_url,
                    "preview_url": preview_url,
                    "isbn": isbn,
                    "publisher": vol.get("publisher", ""),
                    "published_date": vol.get("publishedDate", "")
                }
    except Exception as e:
        print(f"[Google Books API Notice] Lookup skipped: {e}")

    # Fallback broader title search without intitle: quotes if first attempt yielded nothing
    try:
        clean_title = re.sub(r'[^a-zA-Z0-9\s]', ' ', title).strip()
        resp = requests.get(
            GOOGLE_BOOKS_API,
            params={"q": clean_title, "maxResults": 1, "printType": "books"},
            timeout=3.5
        )
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("items", [])
            if items:
                vol = items[0].get("volumeInfo", {})
                img_links = vol.get("imageLinks", {})
                cover_url = img_links.get("thumbnail") or img_links.get("smallThumbnail") or ""
                if cover_url and cover_url.startswith("http://"):
                    cover_url = "https://" + cover_url[7:]
                preview_url = vol.get("previewLink") or vol.get("infoLink") or ""
                if preview_url and preview_url.startswith("http://"):
                    preview_url = "https://" + preview_url[7:]
                return {
                    "matched_title": vol.get("title", title),
                    "matched_authors": ", ".join(vol.get("authors", [])) or author,
                    "cover_url": cover_url,
                    "preview_url": preview_url,
                    "isbn": "",
                    "publisher": vol.get("publisher", ""),
                    "published_date": vol.get("publishedDate", "")
                }
    except Exception:
        pass

    return {}


def search_web_reading_links(title: str, author: str = "", course_name: str = "") -> List[Dict[str, str]]:
    """
    Search DuckDuckGo & academic sources for free PDFs, syllabus links, or library records.
    Used as manual scraping fallback when book is not found in catalog or student wants web links.
    """
    queries = [
        f"{title} {author} textbook syllabus reading pdf".strip(),
        f"{title} {course_name} book pdf free download open access".strip()
    ]

    combined_results: List[Dict[str, str]] = []
    seen_urls = set()

    for q in queries:
        try:
            results = search_web_for_context(q, max_results=3)
            for r in results:
                url = r.get("url", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    combined_results.append(r)
        except Exception:
            continue
        if len(combined_results) >= 4:
            break

    return combined_results[:4]


def extract_readings_with_llm(
    course_name: str,
    transcripts_summary: str,
    slides_text: str
) -> List[Dict[str, Any]]:
    """
    Use LLM to extract reading materials, textbooks, and journal articles
    from transcripts and slides.
    """
    groq_key = os.getenv("GROQ_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    openai_key = os.getenv("OPENAI_API_KEY", "")
    openai_base = os.getenv("LLAMA_OPENAI_BASE", os.getenv("LLAMA_API_BASE", ""))

    system_prompt = (
        f"You are an expert academic curriculum assistant analyzing course materials for '{course_name}'. "
        "Your task is to identify and extract any textbooks, reference books, ebooks, journal articles, "
        "or academic papers explicitly mentioned, assigned, or recommended by the instructor. "
        "Look for book titles, authors, editions, syllabus readings, textbook slide references, and reading assignments.\n\n"
        "Return ONLY a valid JSON array of objects with the following keys:\n"
        "- title: (string) Full book or article title\n"
        "- author: (string) Author(s) or editor(s)\n"
        "- edition: (string) Edition or publication year if stated, else ''\n"
        "- reading_type: ('book' | 'ebook' | 'journal' | 'paper')\n"
        "- category: ('primary_textbook' | 'reference' | 'supplementary')\n"
        "- source_type: ('transcript' | 'slide_ppt' | 'syllabus')\n"
        "- source_context: (string) Specific context or timestamp/slide where mentioned\n\n"
        "If no specific books or papers are mentioned, output an empty JSON array: []. "
        "Do not include any explanation or markdown formatting."
    )

    user_prompt = (
        f"Course: {course_name}\n\n"
        f"--- LECTURE TRANSCRIPTS EXCERPTS ---\n{transcripts_summary[:12000]}\n\n"
        f"--- PROFESSOR SLIDE DECKS TEXT ---\n{slides_text[:12000]}\n\n"
        "Extracted Readings JSON:"
    )

    raw_json_str = ""

    # 1. Try Groq
    if groq_key:
        try:
            from openai import OpenAI
            client = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=groq_key)
            resp = client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=1200,
                temperature=0.1
            )
            raw_json_str = resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"[LLM Groq Readings Notice] {e}")

    # 2. Try Gemini
    if not raw_json_str and gemini_key:
        try:
            from openai import OpenAI
            client = OpenAI(base_url="https://generativelanguage.googleapis.com/v1beta/openai/", api_key=gemini_key)
            resp = client.chat.completions.create(
                model="gemini-3.8-flash",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=1200,
                temperature=0.1
            )
            raw_json_str = resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"[LLM Gemini Readings Notice] {e}")

    # 3. Try OpenAI / Ollama
    if not raw_json_str and (openai_key or openai_base):
        try:
            from openai import OpenAI
            client = OpenAI(
                base_url=openai_base or "https://api.openai.com/v1",
                api_key=openai_key or "local"
            )
            resp = client.chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=1200,
                temperature=0.1
            )
            raw_json_str = resp.choices[0].message.content.strip()
        except Exception as e:
            print(f"[LLM OpenAI Readings Notice] {e}")

    items = []
    if raw_json_str:
        try:
            clean_str = re.sub(r"^```(?:json)?\s*", "", raw_json_str)
            clean_str = re.sub(r"\s*```$", "", clean_str)
            parsed = json.loads(clean_str)
            if isinstance(parsed, list):
                items = parsed
        except Exception as e:
            print(f"[Readings JSON Parse Error] {e} on string: {raw_json_str[:200]}")

    # Deduplicate items by lowercased title
    deduped: List[Dict[str, Any]] = []
    seen_titles = set()
    for item in items:
        t = (item.get("title") or "").strip()
        if not t or len(t) < 3:
            continue
        norm_t = re.sub(r'[^a-zA-Z0-9]', '', t.lower())
        if norm_t not in seen_titles:
            seen_titles.add(norm_t)
            deduped.append(item)

    return deduped

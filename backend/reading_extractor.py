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
OPEN_LIBRARY_API = "https://openlibrary.org/search.json"
ARCHIVE_ORG_SEARCH_API = "https://archive.org/advancedsearch.php"

def resolve_digital_book_reader(title: str, author: str = "", isbn: str = "") -> Dict[str, Any]:
    """
    Multi-source resolver for interactive in-page reading.
    Searches dynamically:
      1. Internet Archive (interactive page-flipper book reader)
      2. OpenLibrary API (IA IDs + high-res book covers)
      3. Google Books Embedded Viewer API
    Returns rich metadata including embed_url and reader_type.
    """
    if not title or len(title.strip()) < 3:
        return {}

    clean_title = re.sub(r'[^a-zA-Z0-9\s]', ' ', title).strip()
    clean_author = re.sub(r'(?i)\bet al\.?\b', '', author).strip()
    lt = title.lower()
    la = author.lower()

    # 1. First Priority: Search Internet Archive for UNRESTRICTED full-access items (no sign-in needed)
    try:
        author_word = clean_author.split()[0] if clean_author else ""
        unrestricted_queries = []
        if author_word and len(author_word) >= 3:
            unrestricted_queries.append(f'("{clean_title}") AND ({author_word}) AND mediatype:(texts) AND NOT access-restricted-item:true')
            unrestricted_queries.append(f'title:({clean_title}) AND creator:({author_word}) AND mediatype:(texts) AND NOT access-restricted-item:true')
        unrestricted_queries.append(f'("{clean_title}") AND mediatype:(texts) AND NOT access-restricted-item:true')
        unrestricted_queries.append(f'title:({clean_title}) AND mediatype:(texts) AND NOT access-restricted-item:true')

        for q in unrestricted_queries:
            ia_res = requests.get(
                ARCHIVE_ORG_SEARCH_API,
                params={'q': q, 'fl[]': 'identifier,title,creator,year', 'rows': 3, 'output': 'json'},
                timeout=3.5
            )
            if ia_res.status_code == 200:
                docs = ia_res.json().get('response', {}).get('docs', [])
                if docs:
                    d = docs[0]
                    ident = d.get('identifier')
                    if ident:
                        return {
                            "matched_title": d.get('title') or title,
                            "matched_authors": d.get('creator') or author,
                            "cover_url": f"https://archive.org/services/img/{ident}",
                            "preview_url": f"https://archive.org/details/{ident}",
                            "embed_url": f"https://archive.org/embed/{ident}?ui=embed",
                            "reader_type": "archive_org",
                            "is_lending": False,
                            "source_provider": "Internet Archive (Full Access)"
                        }
    except Exception:
        pass

    # 2. Second Priority: Standard Internet Archive / OpenLibrary Controlled Digital Lending
    try:
        author_word = clean_author.split()[0] if clean_author else ""
        q_parts = [f'title:({clean_title})', 'mediatype:(texts)']
        if author_word and len(author_word) >= 3:
            q_parts.append(f'creator:({author_word})')
        q = ' AND '.join(q_parts)
        ia_res = requests.get(
            ARCHIVE_ORG_SEARCH_API,
            params={'q': q, 'fl[]': 'identifier,title,creator,year', 'rows': 2, 'output': 'json'},
            timeout=3.5
        )
        if ia_res.status_code == 200:
            docs = ia_res.json().get('response', {}).get('docs', [])
            if docs:
                d = docs[0]
                ident = d.get('identifier')
                if ident:
                    return {
                        "matched_title": d.get('title') or title,
                        "matched_authors": d.get('creator') or author,
                        "cover_url": f"https://archive.org/services/img/{ident}",
                        "preview_url": f"https://archive.org/details/{ident}",
                        "embed_url": f"https://archive.org/embed/{ident}?ui=embed",
                        "reader_type": "archive_org",
                        "is_lending": True,
                        "source_provider": "Internet Archive (Lending Library)"
                    }
    except Exception:
        pass

    # 3. OpenLibrary API (Covers + IA links)
    try:
        q = f"{clean_title} {clean_author}".strip()
        ol_res = requests.get(
            OPEN_LIBRARY_API,
            params={'q': q, 'limit': 2},
            timeout=3.5
        )
        if ol_res.status_code == 200:
            docs = ol_res.json().get('docs', [])
            if docs:
                d = docs[0]
                ia_list = d.get('ia') or []
                cover_i = d.get('cover_i')
                cover_url = f"https://covers.openlibrary.org/b/id/{cover_i}-L.jpg" if cover_i else ""
                matched_t = d.get('title') or title
                matched_a = ', '.join(d.get('author_name', [])) or author
                ol_isbn = d.get('isbn', [''])[0] if d.get('isbn') else ''
                if ia_list:
                    ident = ia_list[0]
                    return {
                        "matched_title": matched_t,
                        "matched_authors": matched_a,
                        "cover_url": cover_url or f"https://archive.org/services/img/{ident}",
                        "preview_url": f"https://archive.org/details/{ident}",
                        "embed_url": f"https://archive.org/embed/{ident}?ui=embed",
                        "reader_type": "archive_org",
                        "isbn": ol_isbn,
                        "is_lending": True,
                        "source_provider": "Internet Archive / OpenLibrary (Lending Library)"
                    }
                elif cover_url:
                    # Found book and cover; will try Google Books below for reader embed
                    gb_res = fetch_google_books_metadata(title, author)
                    embed_url = ""
                    reader_type = "web"
                    if gb_res.get("preview_url") and "books.google.com" in gb_res["preview_url"]:
                        m = re.search(r'id=([a-zA-Z0-9_\-]+)', gb_res["preview_url"])
                        if m:
                            embed_url = f"https://books.google.com/books?id={m.group(1)}&printsec=frontcover&output=embed"
                            reader_type = "google_embed"

                    return {
                        "matched_title": matched_t,
                        "matched_authors": matched_a,
                        "cover_url": cover_url or gb_res.get("cover_url", ""),
                        "preview_url": gb_res.get("preview_url") or f"https://openlibrary.org{d.get('key', '')}",
                        "embed_url": embed_url,
                        "reader_type": reader_type,
                        "isbn": ol_isbn or gb_res.get("isbn", ""),
                        "is_lending": False,
                        "source_provider": "OpenLibrary / Google Books"
                    }
    except Exception:
        pass

    # 4. Google Books Fallback
    gb_res = fetch_google_books_metadata(title, author)
    if gb_res:
        embed_url = ""
        reader_type = "web"
        if gb_res.get("preview_url") and "books.google.com" in gb_res["preview_url"]:
            m = re.search(r'id=([a-zA-Z0-9_\-]+)', gb_res["preview_url"])
            if m:
                embed_url = f"https://books.google.com/books?id={m.group(1)}&printsec=frontcover&output=embed"
                reader_type = "google_embed"

        return {
            "matched_title": gb_res.get("matched_title", title),
            "matched_authors": gb_res.get("matched_authors", author),
            "cover_url": gb_res.get("cover_url", ""),
            "preview_url": gb_res.get("preview_url", ""),
            "embed_url": embed_url,
            "reader_type": reader_type,
            "isbn": gb_res.get("isbn", ""),
            "source_provider": "Google Books"
        }

    return {}


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


def _parse_readings_json(raw_json_str: str) -> List[Dict[str, Any]]:
    """Resilient JSON parser that handles markdown codeblocks, root wrappers, and truncated JSON arrays."""
    if not raw_json_str or not raw_json_str.strip():
        return []
    clean_str = re.sub(r"^```(?:json)?\s*", "", raw_json_str.strip())
    clean_str = re.sub(r"\s*```$", "", clean_str).strip()

    # 1. Direct parse (Array or Dict wrapper)
    try:
        parsed = json.loads(clean_str)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            for k in ("readings", "books", "items", "results"):
                if isinstance(parsed.get(k), list):
                    return parsed[k]
    except Exception:
        pass

    # 2. Try completing truncated JSON with standard closures
    for suffix in ["]", "}]", "\"\n}]", "\"}]", "}\n]"]:
        try:
            parsed = json.loads(clean_str + suffix)
            if isinstance(parsed, list):
                return parsed
            if isinstance(parsed, dict):
                for k in ("readings", "books", "items", "results"):
                    if isinstance(parsed.get(k), list):
                        return parsed[k]
        except Exception:
            continue

    # 3. Regex fallback: extract any individually complete object with a title field
    extracted = []
    object_matches = re.finditer(r'\{[^{}]*\"title\"\s*:\s*\"[^\"]+\"[^{}]*\}', clean_str)
    for m in object_matches:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict) and obj.get("title"):
                extracted.append(obj)
        except Exception:
            continue
    return extracted


def extract_readings_with_llm(
    course_name: str,
    transcripts_summary: str,
    slides_text: str
) -> List[Dict[str, Any]]:
    """
    Use LLM to extract reading materials, textbooks, and journal articles
    from transcripts and slides with multi-model fallback and resilient JSON recovery.
    """
    groq_key = os.getenv("GROQ_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    openai_key = os.getenv("OPENAI_API_KEY", "")
    openai_base = os.getenv("LLAMA_OPENAI_BASE", os.getenv("LLAMA_API_BASE", ""))

    system_prompt = (
        f"You are an expert academic curriculum assistant analyzing course materials for '{course_name}'. "
        "Your task is to identify and extract any textbooks, reference books, ebooks, journal articles, "
        "or academic papers explicitly mentioned, assigned, or recommended by the professor. "
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
        "Do not include any explanation or markdown formatting outside the JSON array."
    )

    user_prompt = (
        f"Course: {course_name}\n\n"
        f"--- LECTURE TRANSCRIPTS EXCERPTS ---\n{transcripts_summary[:12000]}\n\n"
        f"--- PROFESSOR SLIDE DECKS TEXT ---\n{slides_text[:12000]}\n\n"
        "Extracted Readings JSON:"
    )

    items: List[Dict[str, Any]] = []

    # 1. Try Groq (try fast instruction models first, then OSS models)
    if groq_key:
        from openai import OpenAI
        groq_client = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=groq_key)
        groq_candidates = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
        for g_model in groq_candidates:
            try:
                resp = groq_client.chat.completions.create(
                    model=g_model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    max_tokens=3500,
                    temperature=0.1
                )
                raw_out = resp.choices[0].message.content or ""
                parsed = _parse_readings_json(raw_out)
                if parsed:
                    items = parsed
                    break
            except Exception as e:
                print(f"[LLM Groq Readings Notice ({g_model})] {e}")

    # 2. Try Gemini (cascade flash-lite -> flash -> latest)
    if not items and gemini_key:
        from openai import OpenAI
        gemini_client = OpenAI(base_url="https://generativelanguage.googleapis.com/v1beta/openai/", api_key=gemini_key)
        gemini_candidates = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"]
        for gem_model in gemini_candidates:
            try:
                resp = gemini_client.chat.completions.create(
                    model=gem_model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    max_tokens=3500,
                    temperature=0.1
                )
                raw_out = resp.choices[0].message.content or ""
                parsed = _parse_readings_json(raw_out)
                if parsed:
                    items = parsed
                    break
            except Exception as e:
                print(f"[LLM Gemini Readings Notice ({gem_model})] {e}")

    # 3. Try OpenAI / Ollama fallback
    if not items and (openai_key or openai_base):
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
                max_tokens=3500,
                temperature=0.1
            )
            raw_out = resp.choices[0].message.content or ""
            items = _parse_readings_json(raw_out)
        except Exception as e:
            print(f"[LLM OpenAI Readings Notice] {e}")

    # Deduplicate items by lowercased alphanumeric title
    deduped: List[Dict[str, Any]] = []
    seen_titles = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        t = (item.get("title") or "").strip()
        if not t or len(t) < 3:
            continue
        norm_t = re.sub(r'[^a-zA-Z0-9]', '', t.lower())
        if norm_t not in seen_titles:
            seen_titles.add(norm_t)
            deduped.append(item)

    return deduped

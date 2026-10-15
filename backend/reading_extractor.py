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
import time
import logging
import traceback
import urllib.parse
import html
import concurrent.futures
import asyncio
import math
from datetime import datetime
from typing import List, Dict, Any, Optional, Set, Tuple

import requests
import httpx
from backend.web_search import search_web_for_context

logger = logging.getLogger("lecturescribe.reading_extractor")

OPENALEX_API = "https://api.openalex.org/works"
SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1/paper/search"
GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1/volumes"
OPEN_LIBRARY_API = "https://openlibrary.org/search.json"
ARCHIVE_ORG_SEARCH_API = "https://archive.org/advancedsearch.php"
CROSSREF_API = "https://api.crossref.org/works"
EUROPE_PMC_API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"


def extract_citation_components(query: str) -> Tuple[str, str, str]:
    """
    Decomposes academic queries like:
      - 'Vaswani et al. Attention Is All You Need'
      - 'Attention Is All You Need (Vaswani 2017)'
      - 'He et al., Deep Residual Learning for Image Recognition'
      - 'Designing Data-Intensive Applications by Martin Kleppmann'
    Returns: (clean_title_or_topic, author_filter, year_filter)
    """
    text = query.strip()
    if not text:
        return "", "", ""

    # 1. Strip query prefix markers
    text = re.sub(r'^(?:paper|book|reading|journal|title|topic)\s*:\s*', '', text, flags=re.IGNORECASE).strip()

    # 2. Extract 4-digit year if present (e.g., '(2017)' or standalone '2017')
    year_match = re.search(r'\b(19\d{2}|20\d{2})\b', text)
    year = year_match.group(1) if year_match else ""
    if year:
        text = re.sub(rf'\b\(?{year}\)?\b', '', text).strip()

    # 3. Extract author prefix with 'et al.' or 'and colleagues' (e.g., 'Vaswani et al. Attention Is All You Need')
    author = ""
    author_prefix_match = re.match(
        r'^([A-Z][a-zA-Z\-\'\s]+?)\s+(?:et\s+al\.?|and\s+colleagues)\s*[,:\-–—.]*\s*(.+)$',
        text,
        flags=re.IGNORECASE
    )
    if author_prefix_match:
        author = author_prefix_match.group(1).strip()
        text = author_prefix_match.group(2).strip()
    else:
        # Check trailing author (e.g. 'Attention Is All You Need by Vaswani et al.' or 'Designing Data-Intensive Applications by Martin Kleppmann')
        by_match = re.search(
            r'\b(?:by|author:?)\s+([A-Z][a-zA-Z\-\'\s]+?)(?:\s+et\s+al\.?)?$',
            text,
            flags=re.IGNORECASE
        )
        if by_match:
            author = by_match.group(1).strip()
            text = text[:by_match.start()].strip()

    # 4. Clean leftover trailing punctuation or stray quotes
    clean_text = re.sub(r'^[\s\-–—:.,"]+|[\s\-–—:.,"]+$', '', text).strip()
    return clean_text or query, author, year


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
        logger.debug(f"[ReadingExtractor] Title '{title}' too short or empty for digital book reader resolution.")
        return {}

    logger.info(f"[ReadingExtractor] Resolving digital book reader for title='{title}', author='{author}', isbn='{isbn}'")
    clean_title = re.sub(r'[^a-zA-Z0-9\s]', ' ', title).strip()
    clean_author = re.sub(r'(?i)\bet al\.?\b', '', author).strip()

    # 1. First Priority: OpenLibrary API (curated catalog of published books + exact IA book IDs)
    try:
        author_word = clean_author.split()[0] if clean_author else ""
        ol_query = f"{clean_title} {author_word}".strip()
        logger.debug(f"[ReadingExtractor] [OpenLibrary] Querying OpenLibrary: '{ol_query}'")
        ol_res = requests.get(
            OPEN_LIBRARY_API,
            params={'q': ol_query, 'limit': 3},
            timeout=3.5
        )
        if ol_res.status_code == 200:
            docs = ol_res.json().get('docs', [])
            for d in docs:
                ia_list = d.get('ia') or []
                cover_i = d.get('cover_i')
                cover_url = f"https://covers.openlibrary.org/b/id/{cover_i}-L.jpg" if cover_i else ""
                matched_t = d.get('title') or title
                matched_a = ', '.join(d.get('author_name', [])) or author
                ol_isbn = d.get('isbn', [''])[0] if d.get('isbn') else ''
                # Filter out paper preprints from IA list if book has a published ID
                valid_ia = [i for i in ia_list if not i.startswith('arxiv-') and not i.startswith('arxiv_')]
                if valid_ia:
                    ident = valid_ia[0]
                    logger.info(f"[ReadingExtractor] [OpenLibrary] Match found with IA book ID '{ident}': '{matched_t}'")
                    return {
                        "matched_title": matched_t,
                        "matched_authors": matched_a,
                        "cover_url": cover_url or f"https://archive.org/services/img/{ident}",
                        "preview_url": f"https://archive.org/details/{ident}",
                        "embed_url": f"https://archive.org/embed/{ident}?ui=embed",
                        "reader_type": "archive_org",
                        "isbn": ol_isbn,
                        "is_lending": True,
                        "source_provider": "Internet Archive / OpenLibrary"
                    }
                elif cover_url:
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
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [OpenLibrary] Exception during search: {e}")

    # 2. Second Priority: Internet Archive Search (filtering out arxiv research paper uploads)
    try:
        author_word = clean_author.split()[0] if clean_author else ""
        ia_queries = []
        if author_word and len(author_word) >= 3:
            ia_queries.append(f'title:("{clean_title}") AND creator:({author_word}) AND mediatype:(texts) AND NOT identifier:(arxiv*)')
            ia_queries.append(f'("{clean_title}") AND ({author_word}) AND mediatype:(texts) AND NOT identifier:(arxiv*)')
        ia_queries.append(f'title:("{clean_title}") AND mediatype:(texts) AND NOT identifier:(arxiv*)')
        ia_queries.append(f'("{clean_title}") AND mediatype:(texts) AND NOT identifier:(arxiv*)')

        for q in ia_queries:
            logger.debug(f"[ReadingExtractor] [IA Search] Querying Archive.org: {q}")
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
                        logger.info(f"[ReadingExtractor] [IA Search] Match found: '{d.get('title')}' (id: {ident})")
                        return {
                            "matched_title": d.get('title') or title,
                            "matched_authors": d.get('creator') or author,
                            "cover_url": f"https://archive.org/services/img/{ident}",
                            "preview_url": f"https://archive.org/details/{ident}",
                            "embed_url": f"https://archive.org/embed/{ident}?ui=embed",
                            "reader_type": "archive_org",
                            "is_lending": True,
                            "source_provider": "Internet Archive"
                        }
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [IA Search] Exception during search: {e}")

    # 4. Google Books Fallback
    logger.debug(f"[ReadingExtractor] Trying Google Books fallback for title='{title}', author='{author}'")
    gb_res = fetch_google_books_metadata(title, author)
    if gb_res:
        embed_url = ""
        reader_type = "web"
        if gb_res.get("preview_url") and "books.google.com" in gb_res["preview_url"]:
            m = re.search(r'id=([a-zA-Z0-9_\-]+)', gb_res["preview_url"])
            if m:
                embed_url = f"https://books.google.com/books?id={m.group(1)}&printsec=frontcover&output=embed"
                reader_type = "google_embed"

        logger.info(f"[ReadingExtractor] [Google Books] Match found: '{gb_res.get('matched_title')}' (reader_type: {reader_type})")
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

    # 5. Fifth Priority: Academic Literature Fallback (Crossref & Europe PMC for research papers & journal articles)
    logger.debug(f"[ReadingExtractor] Trying Academic Literature fallback for title='{title}', author='{author}'")
    pmc_res = fetch_europe_pmc_metadata(title, author)
    if pmc_res:
        logger.info(f"[ReadingExtractor] [Europe PMC] Match found: '{pmc_res.get('matched_title')}'")
        return {
            "matched_title": pmc_res.get("matched_title", title),
            "matched_authors": pmc_res.get("matched_authors", author),
            "cover_url": pmc_res.get("cover_url", ""),
            "preview_url": pmc_res.get("preview_url", ""),
            "embed_url": pmc_res.get("embed_url", ""),
            "reader_type": pmc_res.get("reader_type", "web"),
            "isbn": pmc_res.get("doi", ""),
            "is_lending": False,
            "source_provider": pmc_res.get("source_provider", "Europe PMC / PubMed")
        }

    cr_res = fetch_crossref_metadata(title, author)
    if cr_res:
        logger.info(f"[ReadingExtractor] [Crossref] Match found: '{cr_res.get('matched_title')}'")
        return {
            "matched_title": cr_res.get("matched_title", title),
            "matched_authors": cr_res.get("matched_authors", author),
            "cover_url": cr_res.get("cover_url", ""),
            "preview_url": cr_res.get("preview_url", ""),
            "embed_url": cr_res.get("embed_url", ""),
            "reader_type": cr_res.get("reader_type", "web"),
            "isbn": cr_res.get("doi", ""),
            "is_lending": False,
            "source_provider": cr_res.get("source_provider", "Crossref")
        }

    logger.info(f"[ReadingExtractor] No digital reader or metadata found across all sources for '{title}'.")
    return {}


def fetch_google_books_metadata(title: str, author: str = "") -> Dict[str, Any]:
    """
    Query Google Books API (free, keyless) to retrieve official cover,
    preview URL, ISBN, and publication metadata.
    """
    if not title or len(title.strip()) < 3:
        logger.debug(f"[ReadingExtractor] [Google Books API] Title '{title}' too short; skipping.")
        return {}

    clean_t, parsed_author, _ = extract_citation_components(title)
    final_author = parsed_author or author

    query_parts = [f'intitle:"{clean_t.strip()}"']
    if final_author and len(final_author.strip()) >= 3:
        clean_author = re.sub(r'(?i)\bet al\.?\b', '', final_author).strip().split()[0]
        if clean_author:
            query_parts.append(f'inauthor:"{clean_author}"')

    query = " ".join(query_parts)
    logger.debug(f"[ReadingExtractor] [Google Books API] Querying primary: {query}")
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

                logger.info(f"[ReadingExtractor] [Google Books API] Primary search matched: '{vol.get('title')}' by {vol.get('authors', [])}")
                return {
                    "matched_title": vol.get("title", title),
                    "matched_authors": ", ".join(vol.get("authors", [])) or final_author,
                    "cover_url": cover_url,
                    "preview_url": preview_url,
                    "isbn": isbn,
                    "publisher": vol.get("publisher", ""),
                    "published_date": vol.get("publishedDate", "")
                }
            else:
                logger.debug("[ReadingExtractor] [Google Books API] Primary search returned 0 items.")
        else:
            logger.debug(f"[ReadingExtractor] [Google Books API] Primary search responded with status {resp.status_code}")
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Google Books API] Primary lookup failed: {e}")

    # Fallback broader title search without intitle: quotes if first attempt yielded nothing
    try:
        clean_title = re.sub(r'[^a-zA-Z0-9\s]', ' ', clean_t).strip()
        logger.debug(f"[ReadingExtractor] [Google Books API] Querying fallback broader: '{clean_title}'")
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
                logger.info(f"[ReadingExtractor] [Google Books API] Fallback search matched: '{vol.get('title')}'")
                return {
                    "matched_title": vol.get("title", title),
                    "matched_authors": ", ".join(vol.get("authors", [])) or final_author,
                    "cover_url": cover_url,
                    "preview_url": preview_url,
                    "isbn": "",
                    "publisher": vol.get("publisher", ""),
                    "published_date": vol.get("publishedDate", "")
                }
            else:
                logger.debug("[ReadingExtractor] [Google Books API] Fallback search returned 0 items.")
        else:
            logger.debug(f"[ReadingExtractor] [Google Books API] Fallback search responded with status {resp.status_code}")
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Google Books API] Fallback lookup failed: {e}")

    return {}


def fetch_crossref_metadata(title: str, author: str = "") -> Dict[str, Any]:
    """
    Query Crossref API (keyless, public) for academic papers, DOIs, journals, and citations.
    """
    if not title or len(title.strip()) < 3:
        return {}

    clean_title, parsed_author, _ = extract_citation_components(title)
    final_author = parsed_author or author

    query = f"{clean_title} {final_author}".strip()
    try:
        resp = requests.get(
            CROSSREF_API,
            params={"query.bibliographic": query, "rows": 1},
            headers={"User-Agent": "LectureScribe/1.0 (mailto:academic-research@lecturescribe.local)"},
            timeout=4.0
        )
        if resp.status_code == 200:
            items = resp.json().get("message", {}).get("items", [])
            if items:
                it = items[0]
                matched_t = (it.get("title") or [""])[0] or clean_title
                authors_list = []
                for a in it.get("author", []):
                    given = a.get("given", "")
                    family = a.get("family", "")
                    if family:
                        authors_list.append(f"{given} {family}".strip() if given else family)
                    elif a.get("name"):
                        authors_list.append(a.get("name"))
                matched_a = ", ".join(authors_list) or final_author
                containers = it.get("container-title") or []
                journal = containers[0] if containers else it.get("publisher", "")
                doi = it.get("DOI", "")
                url = it.get("URL") or (f"https://doi.org/{doi}" if doi else "")

                # Extract year
                issued_parts = it.get("issued", {}).get("date-parts", [[None]])[0]
                year = str(issued_parts[0]) if issued_parts and issued_parts[0] else ""

                return {
                    "matched_title": matched_t,
                    "matched_authors": matched_a,
                    "title": matched_t,
                    "author": matched_a,
                    "publisher": journal,
                    "journal": journal,
                    "year": year,
                    "doi": doi,
                    "preview_url": url,
                    "embed_url": "",
                    "reader_type": "web",
                    "reading_type": "journal" if "journal" in (it.get("type") or "").lower() else "paper",
                    "source_provider": f"Crossref ({journal})" if journal else "Crossref"
                }
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Crossref] Lookup failed: {e}")
    return {}


def fetch_europe_pmc_metadata(title: str, author: str = "") -> Dict[str, Any]:
    """
    Query Europe PMC / PubMed Central API for biomedical literature, free full-text PMC articles, and PDFs.
    """
    if not title or len(title.strip()) < 3:
        return {}

    clean_title, parsed_author, _ = extract_citation_components(title)
    final_author = parsed_author or author

    query = f'TITLE:"{clean_title}"'
    if final_author:
        clean_author = final_author.split()[0]
        if clean_author and len(clean_author) >= 3:
            query += f' AUTH:"{clean_author}"'

    try:
        resp = requests.get(
            EUROPE_PMC_API,
            params={"query": query, "format": "json", "pageSize": 1, "resultType": "core"},
            headers={"User-Agent": "LectureScribe/1.0"},
            timeout=4.0
        )
        if resp.status_code == 200:
            results = resp.json().get("resultList", {}).get("result", [])
            if results:
                r = results[0]
                matched_t = (r.get("title") or clean_title).rstrip(".")
                matched_a = r.get("authorString") or final_author
                journal = r.get("journalTitle") or ""
                year = str(r.get("pubYear") or "")
                doi = r.get("doi") or ""
                pmcid = r.get("pmcid") or ""
                is_oa = r.get("isOpenAccess") == "Y"
                abstract = r.get("abstractText") or ""

                embed_url = ""
                reader_type = "web"
                if pmcid:
                    embed_url = f"https://europepmc.org/articles/{pmcid}"
                    reader_type = "pmc_reader"
                elif is_oa and doi:
                    embed_url = f"https://doi.org/{doi}"

                preview_url = f"https://doi.org/{doi}" if doi else (f"https://europepmc.org/articles/{pmcid}" if pmcid else "")

                return {
                    "matched_title": matched_t,
                    "matched_authors": matched_a,
                    "title": matched_t,
                    "author": matched_a,
                    "publisher": journal,
                    "journal": journal,
                    "year": year,
                    "doi": doi,
                    "pmcid": pmcid,
                    "abstract": abstract,
                    "is_open_access": is_oa,
                    "preview_url": preview_url,
                    "embed_url": embed_url,
                    "reader_type": reader_type,
                    "reading_type": "journal",
                    "source_provider": "Europe PMC / PubMed"
                }
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Europe PMC] Lookup failed: {e}")
    return {}


def _clean_html_text(text: Any) -> str:
    """Strip all HTML/XML tags and unescape entities into clean plain text."""
    if not text:
        return ""
    s = str(text)
    # Strip HTML / XML tags e.g. <jats:p>, <h4>, <b>, <i>, <br/>, <p>
    s = re.sub(r'<[^>]+>', ' ', s)
    # Unescape HTML entities e.g. &amp;, &lt;, &gt;, &quot;, &#39;
    s = html.unescape(s)
    # Collapse multiple whitespace characters into a single space
    return re.sub(r'\s+', ' ', s).strip()


def _extract_year(raw_val: Any) -> str:
    """Extract a 4-digit year as string or empty string."""
    if not raw_val:
        return ""
    s = str(raw_val).strip()
    m = re.search(r'\b(1[89]\d{2}|20\d{2})\b', s)
    if m:
        return m.group(1)
    m = re.search(r'\b\d{4}\b', s)
    if m:
        return m.group(0)
    return ""


def _normalize_doi(doi: str) -> str:
    """Normalize DOI to lowercase, stripped without URL prefix."""
    if not doi:
        return ""
    d = doi.strip().lower()
    return re.sub(r'^(?:https?://(?:dx\.)?doi\.org/|doi:)', '', d).strip()


def _normalize_title(title: str) -> str:
    """Normalize title for alphanumeric matching."""
    return re.sub(r'[^a-zA-Z0-9]', '', (title or '').lower())


GENERIC_TITLES: Set[str] = {
    "introduction", "editorial", "review", "erratum", "preface",
    "foreword", "conclusion", "authorindex", "subjectindex"
}


def _extract_primary_title(title: str) -> str:
    """Isolates main title prior to subtitles (delimited by ':', ' - ', ' — ')."""
    clean = re.split(r'[:\-–—]', title or "", maxsplit=1)[0]
    return re.sub(r'[^a-zA-Z0-9\s]', '', clean.lower()).strip()


def _extract_author_surnames(author_str: str) -> Set[str]:
    """Extracts lowercase author family names for secondary validation."""
    if not author_str:
        return set()
    surnames = set()
    for part in re.split(r'[,;]', author_str):
        tokens = [re.sub(r'[^a-z]', '', t.lower()) for t in part.split() if len(t) > 1]
        if tokens:
            surnames.add(tokens[-1])
            surnames.add(tokens[0])
    return {s for s in surnames if len(s) >= 3}


def _token_jaccard_similarity(str_a: str, str_b: str) -> float:
    """Computes Jaccard similarity across word tokens."""
    tokens_a = set(re.findall(r'\b[a-z0-9]{3,}\b', str_a.lower()))
    tokens_b = set(re.findall(r'\b[a-z0-9]{3,}\b', str_b.lower()))
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / len(tokens_a | tokens_b)


def reconstruct_inverted_abstract(inverted_index: dict[str, list[int]] | None) -> str | None:
    """
    Reconstructs the full text from OpenAlex's abstract_inverted_index.
    Guarantees zero crashes on None, empty dict, or irregular positions.
    """
    if not inverted_index or not isinstance(inverted_index, dict):
        return None
    pos_map: Dict[int, str] = {}
    for word, positions in inverted_index.items():
        if isinstance(positions, list):
            for pos in positions:
                if isinstance(pos, int) and pos >= 0:
                    pos_map[pos] = word
    if not pos_map:
        return None
    max_idx = max(pos_map.keys())
    tokens = [pos_map.get(i, "") for i in range(max_idx + 1)]
    reconstructed = " ".join(t for t in tokens if t).strip()
    return reconstructed if reconstructed else None


def extract_canonical_arxiv_id(text: Optional[str]) -> Optional[str]:
    """
    Extracts and normalizes canonical arXiv ID (e.g. '1706.03762v5' -> '1706.03762',
    'hep-th/9901001v2' -> 'hep-th/9901001').
    Strictly anchored to arXiv URLs, explicit arxiv: prefixes, or pure standalone arXiv IDs.
    Does NOT match DOIs containing year-sequence patterns (e.g. '10.1109/iccv.2019.00069').
    """
    if not text:
        return None
    s = str(text).strip()
    # 1. URL pattern: arxiv.org/abs/... or arxiv.org/pdf/...
    m = re.search(r'arxiv\.org/(?:abs|pdf)/([a-zA-Z\-]+(?:\.[a-zA-Z\-]+)?/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?', s, flags=re.IGNORECASE)
    if m:
        return m.group(1).lower()

    # 2. ArXiv DOI pattern: 10.48550/arXiv....
    m = re.search(r'10\.48550/arxiv\.([a-zA-Z\-]+(?:\.[a-zA-Z\-]+)?/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?', s, flags=re.IGNORECASE)
    if m:
        return m.group(1).lower()

    # 3. Explicit arxiv: prefix (e.g. 'arxiv: 1706.03762v5', 'arXiv:hep-th/9901001')
    m = re.search(r'(?:^|[\s/([,;:])arxiv:\s*([a-zA-Z\-]+(?:\.[a-zA-Z\-]+)?/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?', s, flags=re.IGNORECASE)
    if m:
        return m.group(1).lower()

    # 4. Pure standalone arXiv ID (e.g. '1706.03762v5', '2103.14899', 'hep-th/9901001')
    m = re.match(r'^(?:arxiv:\s*)?([a-zA-Z\-]+(?:\.[a-zA-Z\-]+)?/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$', s, flags=re.IGNORECASE)
    if m:
        return m.group(1).lower()

    return None


class DirectPdfResolver:
    """
    Validates and resolves authentic binary direct PDF URLs versus DOI/publisher landing pages.
    """
    DISALLOWED_PDF_DOMAINS = (
        "doi.org",
        "sciencedirect.com",
        "iopscience.iop.org",
        "nature.com",
        "ieeexplore.ieee.org",
        "springer.com",
        "wiley.com",
        "tandfonline.com",
        "cell.com",
        "frontiersin.org",
        "mdpi.com",
        "acm.org",
        "oup.com",
        "cambridge.org",
        "plos.org"
    )

    @classmethod
    def is_authentic_pdf_url(cls, url: Optional[str]) -> bool:
        if not url or not isinstance(url, str):
            return False
        clean_url = url.strip()
        if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
            return False

        parsed = urllib.parse.urlparse(clean_url)
        netloc = parsed.netloc.lower()
        path = parsed.path.lower()

        # Reject known landing page publishers unless path explicitly terminates in .pdf
        for blocked in cls.DISALLOWED_PDF_DOMAINS:
            if blocked in netloc:
                if not path.endswith(".pdf"):
                    return False

        # If it's a DOI path or landing page
        if "doi.org" in netloc or "/doi/" in path or "/abs/" in path:
            if not path.endswith(".pdf"):
                return False

        # Explicit PDF signals
        if path.endswith(".pdf") or "arxiv.org/pdf/" in clean_url or "/pdfstream/" in path:
            return True

        return False

    @classmethod
    def resolve_pdf(cls, candidate_url: Optional[str], arxiv_id: Optional[str] = None) -> Tuple[str, str]:
        """
        Returns (direct_pdf_url, reader_type).
        If authentic PDF, returns (clean_url, "pdf_direct").
        If invalid landing page, falls back to arxiv PDF if arxiv_id exists, else returns ("", "web").
        """
        if candidate_url and cls.is_authentic_pdf_url(candidate_url):
            return candidate_url.strip(), "pdf_direct"

        # ArXiv fallback
        if arxiv_id:
            canon_arxiv = extract_canonical_arxiv_id(arxiv_id)
            if canon_arxiv:
                return f"https://arxiv.org/pdf/{canon_arxiv}.pdf", "pdf_direct"

        return "", "web"


class DomainRouter:
    """
    Routes academic literature search requests across providers based on course slug/name and query intent.
    Enforces strict hard exclusions (e.g. Europe PMC NEVER allowed for STEM_CS).
    """
    STEM_CS_SLUGS: Set[str] = {
        "technology",
        "master-of-technology",
        "computer-science",
        "data-science",
        "artificial-intelligence",
        "software-engineering",
        "electrical",
        "mtech",
        "cs",
        "engineering",
        "machine-learning",
        "robotics",
        "cybersecurity",
        "information-technology"
    }

    BIOMEDICAL_SLUGS: Set[str] = {
        "medicine",
        "biomedical",
        "health",
        "clinical",
        "nursing",
        "pharmacy",
        "biology",
        "life-sciences",
        "oncology",
        "immunology",
        "neuroscience"
    }

    @classmethod
    def classify_domain(cls, course_name: str, query: str = "") -> str:
        course_clean = (course_name or "").lower().strip()
        slug = re.sub(r'[^a-z0-9]+', '-', course_clean).strip('-')
        tokens = set(re.findall(r'[a-z0-9]+', course_clean))

        # 1. Match against STEM/CS course keywords or slugs
        if slug in cls.STEM_CS_SLUGS or any(t in cls.STEM_CS_SLUGS for t in tokens):
            return "STEM_CS"

        for s in cls.STEM_CS_SLUGS:
            if s in slug:
                return "STEM_CS"

        # 2. Match against Biomedical course keywords or slugs
        if slug in cls.BIOMEDICAL_SLUGS or any(t in cls.BIOMEDICAL_SLUGS for t in tokens):
            return "BIOMEDICAL"

        for s in cls.BIOMEDICAL_SLUGS:
            if s in slug:
                return "BIOMEDICAL"

        # 3. If query itself strongly implies medicine/clinical and no course provided
        q_lower = query.lower()
        if re.search(r'\b(clinical|patient|rct|oncology|disease|therapy|pubmed|pmcid)\b', q_lower):
            return "BIOMEDICAL"

        if re.search(r'\b(transformer|neural network|algorithm|compiler|deep learning|arxiv|gpu|attention)\b', q_lower):
            return "STEM_CS"

        return "GENERAL"

    @classmethod
    def get_providers_for_domain(cls, domain: str, query: str = "") -> Tuple[List[str], List[str]]:
        """
        Returns (dispatched_providers, excluded_providers).
        """
        intent = _classify_query_intent(query)
        dispatched: List[str] = []
        excluded: List[str] = []

        if domain == "STEM_CS":
            # Primary: OpenAlex, Semantic Scholar, Crossref, Google Books
            dispatched = ["openalex", "semantic_scholar", "crossref", "google_books"]
            # HARD EXCLUSION: Europe PMC is forbidden
            excluded = ["europe_pmc"]
        elif domain == "BIOMEDICAL":
            dispatched = ["openalex", "europe_pmc", "semantic_scholar", "crossref"]
            if intent in ("monograph", "general"):
                dispatched.append("google_books")
            excluded = []
        else:
            # General / Unconstrained
            dispatched = ["openalex", "semantic_scholar", "crossref", "google_books"]
            excluded = []

        logger.info(f"[DomainRouter] Dispatching to: {dispatched} | Excluded: {excluded} (domain={domain})")
        return dispatched, excluded


def _classify_query_intent(query: str) -> str:
    """Classifies user query intent into 'monograph', 'paper', or 'general'."""
    q_lower = query.lower()
    if re.search(r'\b(textbook|handbook|monograph|guide|introduction to|principles of|volume|edition|concepts)\b', q_lower):
        return "monograph"
    if re.search(r'\b(et al|jama|nejm|nature|ieee|arxiv|doi|proceedings|trial|paper|conference)\b', q_lower):
        return "paper"
    return "general"


def compute_hybrid_relevance(record: Dict[str, Any], query: str) -> float:
    """
    Mathematically bounded composite relevance scoring function strictly in [0.0, 1.0].
    Final Score = w_lex * S_lex + w_cit * S_cit + w_rec * S_rec + w_oa * S_oa
    where sum(w_i) == 1.0.
    Dynamically balances lexical exact-match boost, citation authority, recency, and open access.
    """
    title = record.get("title") or ""
    abstract = record.get("abstract") or ""
    synthesized = record.get("synthesized_context") or ""

    clean_q, author_q, _ = extract_citation_components(query)
    clean_q_lower = clean_q.lower().strip()
    title_lower = title.lower().strip()

    is_abstract_missing = not abstract or len(abstract.strip()) < 40 or "(Note: Abstract unavailable)" in abstract or bool(synthesized and not abstract)
    if is_abstract_missing:
        w_lex = 0.40
        w_cit = 0.40
        w_rec = 0.15
        w_oa = 0.05
    else:
        w_lex = 0.50
        w_cit = 0.30
        w_rec = 0.15
        w_oa = 0.05

    # 1. Normalized Lexical score S_lex clamped to [0.0, 1.0]
    q_tokens = set(re.findall(r'[a-z0-9]+', clean_q_lower))
    stopwords = {"a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "with", "by", "from", "of", "as", "is", "are", "be"}
    content_q_tokens = {t for t in q_tokens if t not in stopwords and len(t) >= 2} or q_tokens

    text_for_lexical = abstract if (abstract and len(abstract.strip()) >= 40) else (synthesized or title)
    t_tokens = set(re.findall(r'[a-z0-9]+', title_lower))
    doc_tokens = set(re.findall(r'[a-z0-9]+', (text_for_lexical or "").lower()))

    norm_target = _normalize_title(clean_q)
    norm_candidate = _normalize_title(title)

    if not content_q_tokens:
        s_lex = 0.0
    else:
        overlap_title = len(content_q_tokens & t_tokens) / len(content_q_tokens)
        overlap_doc = len(content_q_tokens & doc_tokens) / len(content_q_tokens)
        s_lex = min(1.0, 0.7 * overlap_title + 0.3 * overlap_doc)

        # Exact title equality or substring match gives heavy direct bonus
        if norm_target and norm_candidate and norm_target == norm_candidate:
            s_lex = 1.0
        elif clean_q_lower and (clean_q_lower in title_lower or title_lower in clean_q_lower):
            s_lex = min(1.0, s_lex + 0.35)

    # Author surname alignment boost
    author_matches = False
    if author_q:
        author_tokens = _extract_author_surnames(record.get("author", ""))
        target_surnames = {s.lower() for s in author_q.split() if len(s) >= 3}
        if author_tokens & target_surnames:
            author_matches = True
            s_lex = min(1.0, s_lex + 0.25)

    # 2. Log-normalized citation authority S_cit in [0.0, 1.0]
    citations = max(0, int(record.get("citation_count") or 0))
    s_cit = min(1.0, math.log10(1.0 + citations) / 4.0)

    # 3. Smooth recency decay S_rec with minimum floor in [0.25, 1.0]
    current_year = datetime.now().year
    pub_year_str = str(record.get("publication_year") or "")
    pub_year = int(pub_year_str) if pub_year_str.isdigit() else (current_year - 5)
    delta_y = max(0, current_year - pub_year)
    s_rec = max(0.25, min(1.0, math.exp(-delta_y / 14.0)))

    # 4. Normalized binary OA indicator S_oa in {0.0, 1.0}
    has_pdf = bool(record.get("direct_pdf_url"))
    is_oa = bool(record.get("is_open_access"))
    s_oa = 1.0 if (has_pdf or is_oa) else 0.0

    # Composite score strictly guaranteed in [0.0, 1.0]
    final_score = (w_lex * s_lex) + (w_cit * s_cit) + (w_rec * s_rec) + (w_oa * s_oa)

    # FAST-PATH OVERRIDE: Exact Title + Matching Author gets priority score
    if norm_target and norm_candidate and norm_target == norm_candidate:
        if author_matches or citations > 1000:
            final_score = max(final_score, 0.95)

    return round(min(1.0, max(0.0, final_score)), 4)


class SemanticScholarRateLimiter:
    """
    Token-bucket / Leaky-bucket rate limiter with circuit breaker for Semantic Scholar API.
    Enforces maximum 1 QPS and trips on HTTP 429 with 60-second backoff circuit breaker.
    """
    def __init__(self, min_interval_seconds: float = 1.0):
        self.min_interval = min_interval_seconds
        self.last_request_time = 0.0
        self.circuit_open_until = 0.0
        self.backoff_duration = 60.0
        self._lock: Optional[asyncio.Lock] = None

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def acquire(self) -> bool:
        """
        Returns True if request is allowed, False if circuit is currently open.
        """
        now = time.monotonic()
        if now < self.circuit_open_until:
            logger.debug(f"[ReadingExtractor] S2 circuit open ({self.circuit_open_until - now:.1f}s remaining). Skipping S2 call.")
            return False

        lock = self._get_lock()
        async with lock:
            now = time.monotonic()
            if now < self.circuit_open_until:
                return False
            elapsed = now - self.last_request_time
            if elapsed < self.min_interval:
                await asyncio.sleep(self.min_interval - elapsed)
            self.last_request_time = time.monotonic()
            return True

    def record_success(self):
        self.backoff_duration = 60.0

    def record_429(self):
        now = time.monotonic()
        self.circuit_open_until = now + self.backoff_duration
        logger.warning(
            f"[ReadingExtractor] Semantic Scholar 429 rate limit hit. Tripping circuit breaker for {self.backoff_duration}s."
        )
        self.backoff_duration = min(300.0, self.backoff_duration * 2.0)

    def is_circuit_open(self) -> bool:
        return time.monotonic() < self.circuit_open_until

    def reset_circuit(self):
        self.circuit_open_until = 0.0
        self.backoff_duration = 60.0


_S2_RATE_LIMITER = SemanticScholarRateLimiter()


def _are_records_equivalent(rec_a: Dict[str, Any], rec_b: Dict[str, Any]) -> bool:
    """
    Multi-factor equivalence test:
    1. Canonical DOI matching
    2. Canonical arXiv ID matching
    3. Exact normalized title matching (with short/generic title guard requiring author/year match)
    4. Subtitle delimiter splitting + token Jaccard (>= 0.85) with author/year validation
    """
    doi_a = _normalize_doi(rec_a.get("doi", ""))
    doi_b = _normalize_doi(rec_b.get("doi", ""))
    if doi_a and doi_b and doi_a == doi_b:
        return True

    arxiv_a = extract_canonical_arxiv_id(rec_a.get("arxiv_id") or rec_a.get("preview_url") or rec_a.get("direct_pdf_url"))
    arxiv_b = extract_canonical_arxiv_id(rec_b.get("arxiv_id") or rec_b.get("preview_url") or rec_b.get("direct_pdf_url"))
    if arxiv_a and arxiv_b and arxiv_a == arxiv_b:
        return True

    title_a = rec_a.get("title", "").strip()
    title_b = rec_b.get("title", "").strip()
    norm_a = _normalize_title(title_a)
    norm_b = _normalize_title(title_b)

    if not norm_a or not norm_b:
        return False

    authors_a = _extract_author_surnames(rec_a.get("author", ""))
    authors_b = _extract_author_surnames(rec_b.get("author", ""))
    author_overlap = bool(authors_a & authors_b) if (authors_a and authors_b) else False

    year_a_str = rec_a.get("publication_year", "")
    year_b_str = rec_b.get("publication_year", "")
    year_a = int(year_a_str) if year_a_str.isdigit() else None
    year_b = int(year_b_str) if year_b_str.isdigit() else None
    years_compatible = True
    if year_a and year_b:
        years_compatible = abs(year_a - year_b) <= 1

    # Exact normalized title match
    if norm_a == norm_b:
        if author_overlap:
            return True
        if not years_compatible:
            return False
        # Guard against generic short title collisions
        if norm_a in GENERIC_TITLES or len(norm_a) < 15:
            return author_overlap
        return True

    # Subtitle splitting & token overlap (e.g. cataloger subtitle additions/truncations)
    prim_a = _extract_primary_title(title_a)
    prim_b = _extract_primary_title(title_b)
    jaccard = _token_jaccard_similarity(prim_a, prim_b)

    if jaccard >= 0.85 and years_compatible and (author_overlap or norm_a.startswith(norm_b) or norm_b.startswith(norm_a)):
        return True

    return False


# HTTP Client Singleton for High-Throughput Async Execution
_ASYNC_HTTP_CLIENT: Optional[httpx.AsyncClient] = None

def get_async_http_client() -> httpx.AsyncClient:
    global _ASYNC_HTTP_CLIENT
    if _ASYNC_HTTP_CLIENT is None or _ASYNC_HTTP_CLIENT.is_closed:
        limits = httpx.Limits(max_keepalive_connections=50, max_connections=200, keepalive_expiry=30.0)
        timeout = httpx.Timeout(timeout=3.5, connect=1.5)
        _ASYNC_HTTP_CLIENT = httpx.AsyncClient(
            limits=limits,
            timeout=timeout,
            http2=True,
            follow_redirects=True
        )
    return _ASYNC_HTTP_CLIENT


async def close_async_http_client() -> None:
    global _ASYNC_HTTP_CLIENT
    if _ASYNC_HTTP_CLIENT is not None and not _ASYNC_HTTP_CLIENT.is_closed:
        await _ASYNC_HTTP_CLIENT.aclose()
        _ASYNC_HTTP_CLIENT = None


def _parse_crossref_items(items: list) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for it in items:
        title_list = it.get("title") or []
        raw_title = title_list[0] if (title_list and title_list[0]) else ""
        t = _clean_html_text(raw_title).rstrip(".")
        if not t:
            continue

        authors_list = []
        for a in it.get("author", []):
            given = _clean_html_text(a.get("given", ""))
            family = _clean_html_text(a.get("family", ""))
            if given and family:
                authors_list.append(f"{given} {family}")
            elif family:
                authors_list.append(family)
            elif given:
                authors_list.append(given)
            elif a.get("name"):
                name = _clean_html_text(a.get("name", ""))
                if name:
                    authors_list.append(name)
        authors_str = ", ".join(authors_list)

        containers = it.get("container-title") or []
        journal = _clean_html_text(containers[0]) if (containers and containers[0]) else ""
        publisher = _clean_html_text(it.get("publisher", ""))

        issued_parts = it.get("issued", {}).get("date-parts", [[None]])[0]
        raw_year = issued_parts[0] if issued_parts and issued_parts[0] else ""
        if not raw_year:
            raw_year = it.get("published-print", {}).get("date-parts", [[None]])[0]
            raw_year = raw_year[0] if raw_year and raw_year[0] else ""
        if not raw_year:
            raw_year = it.get("published-online", {}).get("date-parts", [[None]])[0]
            raw_year = raw_year[0] if raw_year and raw_year[0] else ""
        year = _extract_year(raw_year)

        doi = _normalize_doi(it.get("DOI", ""))
        url = it.get("URL") or (f"https://doi.org/{doi}" if doi else "")

        isbn_list = it.get("ISBN") or it.get("isbn-type") or []
        isbn = ""
        if isinstance(isbn_list, list) and isbn_list:
            isbn = str(isbn_list[0]).strip()

        type_str = (it.get("type") or "").lower()
        if "book" in type_str:
            reading_type = "book"
            category = "primary_textbook"
        elif "journal" in type_str:
            reading_type = "journal"
            category = "reference"
        else:
            reading_type = "paper"
            category = "reference"

        abstract = _clean_html_text(it.get("abstract", ""))

        results.append({
            "title": t,
            "author": authors_str,
            "publication_year": year,
            "reading_type": reading_type,
            "category": category,
            "publisher": publisher,
            "journal": journal,
            "doi": doi,
            "arxiv_id": "",
            "pmcid": "",
            "isbn": isbn,
            "cover_url": "",
            "preview_url": url,
            "direct_pdf_url": "",
            "embed_url": "",
            "reader_type": "web",
            "abstract": abstract,
            "citation_count": 0,
            "influential_citation_count": 0,
            "relevance_score": 0.0,
            "source_provider": f"Crossref ({journal})" if journal else "Crossref",
            "is_open_access": False
        })
    return results


def _parse_europe_pmc_items(pmc_items: list) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for r in pmc_items:
        t = _clean_html_text(r.get("title") or "").rstrip(".")
        if not t:
            continue

        doi = _normalize_doi(r.get("doi", ""))
        pmcid = (r.get("pmcid") or "").strip()
        is_oa = r.get("isOpenAccess") == "Y"
        journal = _clean_html_text(r.get("journalTitle") or "")

        pub_info = r.get("journalInfo", {}).get("journal", {}).get("publisher") or r.get("publisher") or ""
        publisher = _clean_html_text(pub_info)

        year = _extract_year(r.get("pubYear") or r.get("firstPublicationDate") or "")
        abstract = _clean_html_text(r.get("abstractText") or "")
        author_str = _clean_html_text(r.get("authorString") or "").rstrip(".")

        embed_url = f"https://europepmc.org/articles/{pmcid}" if pmcid else ""
        preview_url = f"https://doi.org/{doi}" if doi else (embed_url or "")
        reader_type = "pmc_reader" if pmcid else "web"

        results.append({
            "title": t,
            "author": author_str,
            "publication_year": year,
            "reading_type": "journal",
            "category": "reference",
            "publisher": publisher,
            "journal": journal,
            "doi": doi,
            "arxiv_id": "",
            "pmcid": pmcid,
            "isbn": "",
            "cover_url": "",
            "preview_url": preview_url,
            "direct_pdf_url": "",
            "embed_url": embed_url,
            "reader_type": reader_type,
            "abstract": abstract,
            "citation_count": 0,
            "influential_citation_count": 0,
            "relevance_score": 0.0,
            "source_provider": "Europe PMC / PubMed",
            "is_open_access": is_oa
        })
    return results


def _parse_google_books_items(gb_items: list) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for it in gb_items:
        vol = it.get("volumeInfo", {})
        t = _clean_html_text(vol.get("title", "")).strip()
        if not t:
            continue

        img_links = vol.get("imageLinks", {})
        cover_url = img_links.get("thumbnail") or img_links.get("smallThumbnail") or ""
        if cover_url.startswith("http://"):
            cover_url = "https://" + cover_url[7:]

        preview_url = vol.get("previewLink") or vol.get("infoLink") or ""
        if preview_url.startswith("http://"):
            preview_url = "https://" + preview_url[7:]

        embed_url = ""
        reader_type = "web"
        if "books.google.com" in preview_url:
            m = re.search(r'id=([a-zA-Z0-9_\-]+)', preview_url)
            if m:
                embed_url = f"https://books.google.com/books?id={m.group(1)}&printsec=frontcover&output=embed"
                reader_type = "google_embed"

        isbn = ""
        for ident in vol.get("industryIdentifiers", []):
            if ident.get("type") in ("ISBN_13", "ISBN_10"):
                isbn = ident.get("identifier", "").strip()
                break

        raw_authors = vol.get("authors", [])
        if isinstance(raw_authors, list):
            author_str = ", ".join(_clean_html_text(a) for a in raw_authors if a)
        else:
            author_str = _clean_html_text(raw_authors)

        year = _extract_year(vol.get("publishedDate", ""))
        abstract = _clean_html_text(vol.get("description", ""))
        publisher = _clean_html_text(vol.get("publisher", ""))

        results.append({
            "title": t,
            "author": author_str,
            "publication_year": year,
            "reading_type": "book",
            "category": "primary_textbook",
            "publisher": publisher,
            "journal": "",
            "doi": "",
            "arxiv_id": "",
            "pmcid": "",
            "isbn": isbn,
            "cover_url": cover_url,
            "preview_url": preview_url,
            "direct_pdf_url": "",
            "embed_url": embed_url,
            "reader_type": reader_type,
            "abstract": abstract,
            "citation_count": 0,
            "influential_citation_count": 0,
            "relevance_score": 0.0,
            "source_provider": "Google Books",
            "is_open_access": False
        })
    return results


def _parse_openalex_items(items: list) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for it in items:
        raw_title = it.get("title") or ""
        t = _clean_html_text(raw_title).rstrip(".")
        if not t:
            continue

        authors_list = []
        for authorship in it.get("authorships", []):
            name = authorship.get("author", {}).get("display_name")
            if name:
                authors_list.append(_clean_html_text(name))
        author_str = ", ".join(authors_list)

        pub_year = str(it.get("publication_year") or "")
        doi = _normalize_doi(it.get("doi") or "")

        # Extract canonical arXiv ID from ids, doi, or alternate locations
        raw_ids = it.get("ids", {})
        arxiv_raw = raw_ids.get("arxiv") or it.get("id") or (it.get("doi") or "")
        arxiv_id = extract_canonical_arxiv_id(arxiv_raw)

        # Inverted abstract reconstruction
        abstract = reconstruct_inverted_abstract(it.get("abstract_inverted_index")) or ""
        abstract = _clean_html_text(abstract)

        # Open Access & Direct PDF
        oa_obj = it.get("open_access") or {}
        is_oa = bool(oa_obj.get("is_oa", False))
        candidate_pdf = oa_obj.get("oa_url") or ""

        # Check alternate locations in OpenAlex for arXiv ID and direct PDFs
        for loc in it.get("locations", []):
            loc_pdf = loc.get("pdf_url") or ""
            loc_landing = loc.get("landing_page_url") or ""
            if not arxiv_id:
                arxiv_id = extract_canonical_arxiv_id(loc_pdf) or extract_canonical_arxiv_id(loc_landing)
            if not candidate_pdf and loc_pdf:
                candidate_pdf = loc_pdf

        direct_pdf, reader_type = DirectPdfResolver.resolve_pdf(candidate_pdf, arxiv_id)
        if direct_pdf:
            is_oa = True

        primary_loc = it.get("primary_location") or {}
        source_obj = primary_loc.get("source") or {}
        journal = _clean_html_text(source_obj.get("display_name") or "")
        publisher = _clean_html_text(source_obj.get("host_organization_name") or "")

        # REPRINT GUARD: If OpenAlex's primary_location is a later anthology reprint (e.g. 2025)
        # of an earlier arXiv paper (e.g. '1706.03762' -> 2017), restore original year, DOI, and venue.
        if arxiv_id and re.match(r'^\d{4}\.\d{4,5}$', arxiv_id):
            yy = int(arxiv_id[:2])
            arxiv_year = (1900 + yy) if yy >= 91 else (2000 + yy)
            if not pub_year.isdigit() or (int(pub_year) - arxiv_year >= 2):
                pub_year = str(arxiv_year)
                doi = f"10.48550/arxiv.{arxiv_id}"
                # Try to find a non-reprint conference/journal venue in locations, else use arXiv
                orig_venue = ""
                for loc in it.get("locations", []):
                    s_name = _clean_html_text((loc.get("source") or {}).get("display_name") or "")
                    if s_name and s_name != journal and "arxiv" not in s_name.lower():
                        orig_venue = s_name
                        break
                journal = orig_venue or "arXiv (Cornell University)"
                publisher = "Cornell University" if not orig_venue else ""

        citations = it.get("cited_by_count") or 0

        preview_url = f"https://doi.org/{doi}" if doi else (direct_pdf or raw_ids.get("openalex") or "")
        embed_url = direct_pdf if direct_pdf else ""

        type_str = (it.get("type") or "").lower()
        if "book" in type_str and not arxiv_id:
            reading_type = "book"
            category = "primary_textbook"
        else:
            reading_type = "paper"
            category = "reference"

        results.append({
            "title": t,
            "author": author_str,
            "publication_year": pub_year,
            "reading_type": reading_type,
            "category": category,
            "publisher": publisher,
            "journal": journal,
            "doi": doi or "",
            "arxiv_id": arxiv_id or "",
            "pmcid": "",
            "isbn": "",
            "cover_url": "",
            "preview_url": preview_url,
            "direct_pdf_url": direct_pdf or "",
            "embed_url": embed_url,
            "reader_type": reader_type,
            "abstract": abstract,
            "citation_count": citations,
            "influential_citation_count": 0,
            "source_provider": "OpenAlex",
            "is_open_access": is_oa,
            "relevance_score": 0.0,
        })
    return results

def _parse_semantic_scholar_items(items: list) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for it in items:
        raw_title = it.get("title") or ""
        t = _clean_html_text(raw_title).rstrip(".")
        if not t:
            continue

        authors_list = [_clean_html_text(a.get("name", "")) for a in it.get("authors", []) if a.get("name")]
        author_str = ", ".join(authors_list)

        pub_year = str(it.get("year") or "")
        ext_ids = it.get("externalIds") or {}
        doi = _normalize_doi(ext_ids.get("DOI") or "")
        arxiv_raw = ext_ids.get("ArXiv") or ""
        arxiv_id = extract_canonical_arxiv_id(arxiv_raw)

        abstract = _clean_html_text(it.get("abstract") or "")
        citations = it.get("citationCount") or 0
        inf_citations = it.get("influentialCitationCount") or 0

        oa_obj = it.get("openAccessPdf") or {}
        candidate_pdf = oa_obj.get("url") or ""
        direct_pdf, reader_type = DirectPdfResolver.resolve_pdf(candidate_pdf, arxiv_id)
        is_oa = bool(direct_pdf)

        paper_id = it.get("paperId") or ""
        preview_url = f"https://www.semanticscholar.org/paper/{paper_id}" if paper_id else (doi or "")
        embed_url = direct_pdf if direct_pdf else ""

        results.append({
            "title": t,
            "author": author_str,
            "publication_year": pub_year,
            "reading_type": "paper",
            "category": "reference",
            "publisher": "",
            "journal": _clean_html_text(it.get("venue") or ""),
            "doi": doi or "",
            "arxiv_id": arxiv_id or "",
            "pmcid": ext_ids.get("PubMedCentral") or "",
            "isbn": "",
            "cover_url": "",
            "preview_url": preview_url,
            "direct_pdf_url": direct_pdf or "",
            "embed_url": embed_url,
            "reader_type": reader_type,
            "abstract": abstract,
            "citation_count": citations,
            "influential_citation_count": inf_citations,
            "source_provider": "Semantic Scholar",
            "is_open_access": is_oa,
            "relevance_score": 0.0,
        })
    return results


# Candidate Fetchers
def _fetch_crossref_candidates(query: str, limit: int) -> List[Dict[str, Any]]:
    clean_title, author, _ = extract_citation_components(query)
    q = f"{clean_title} {author}".strip()
    try:
        resp = requests.get(
            CROSSREF_API,
            params={
                "query.bibliographic": q,
                "rows": max(limit, 5),
                "filter": "type:journal-article,type:proceedings-article,type:book,type:book-chapter"
            },
            headers={"User-Agent": "LectureScribe/1.0 (mailto:academic-research@lecturescribe.local)"},
            timeout=3.5
        )
        if resp.status_code == 200:
            return _parse_crossref_items(resp.json().get("message", {}).get("items", []))
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Crossref Search] Exception: {e}")
    return []


def _fetch_europe_pmc_candidates(query: str, limit: int) -> List[Dict[str, Any]]:
    clean_title, author, _ = extract_citation_components(query)
    q = f'TITLE:"{clean_title}"'
    if author:
        author_word = author.split()[0]
        if len(author_word) >= 3:
            q += f' AUTH:"{author_word}"'
    try:
        resp = requests.get(
            EUROPE_PMC_API,
            params={"query": q, "format": "json", "pageSize": max(limit, 5), "resultType": "core"},
            headers={"User-Agent": "LectureScribe/1.0"},
            timeout=3.5
        )
        if resp.status_code == 200:
            return _parse_europe_pmc_items(resp.json().get("resultList", {}).get("result", []))
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Europe PMC Search] Exception: {e}")
    return []


def _fetch_google_books_candidates(query: str, limit: int) -> List[Dict[str, Any]]:
    clean_title, author, _ = extract_citation_components(query)
    q = f"{clean_title} {author}".strip()
    try:
        resp = requests.get(
            GOOGLE_BOOKS_API,
            params={"q": q, "maxResults": min(max(limit, 4), 10), "printType": "books"},
            timeout=3.5
        )
        if resp.status_code == 200:
            return _parse_google_books_items(resp.json().get("items", []))
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Google Books Search] Exception: {e}")
    return []


def _fetch_openalex_candidates(query: str, limit: int) -> List[Dict[str, Any]]:
    clean_title, author, _ = extract_citation_components(query)
    headers = {"User-Agent": "LectureScribe/2.3 (mailto:academic-research@lecturescribe.local)"}
    combined_raw: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()

    # Pass 1: Author + Title filter if author is supplied
    if author:
        author_surname = author.split()[0].strip()
        try:
            resp = requests.get(
                OPENALEX_API,
                params={
                    "filter": f"title.search:{clean_title},raw_author_name.search:{author_surname}",
                    "per-page": max(limit, 10),
                    "sort": "cited_by_count:desc"
                },
                headers=headers,
                timeout=3.5
            )
            if resp.status_code == 200:
                for item in resp.json().get("results", []):
                    w_id = str(item.get("id") or item.get("doi") or "")
                    if w_id and w_id not in seen_ids:
                        seen_ids.add(w_id)
                        combined_raw.append(item)
        except Exception as e:
            logger.debug(f"[ReadingExtractor] Sync OpenAlex Author filter lookup failed: {e}")

    # Pass 2: Title filter sorted by citations (guarantees landmark papers are surfaced)
    try:
        resp = requests.get(
            OPENALEX_API,
            params={
                "filter": f"title.search:{clean_title}",
                "per-page": max(limit, 10),
                "sort": "cited_by_count:desc"
            },
            headers=headers,
            timeout=3.5
        )
        if resp.status_code == 200:
            for item in resp.json().get("results", []):
                w_id = str(item.get("id") or item.get("doi") or "")
                if w_id and w_id not in seen_ids:
                    seen_ids.add(w_id)
                    combined_raw.append(item)
    except Exception as e:
        logger.debug(f"[ReadingExtractor] Sync OpenAlex Title citation lookup failed: {e}")

    # Pass 3: General search for broader topics
    search_q = f"{clean_title} {author}".strip() if author else clean_title
    try:
        resp = requests.get(
            OPENALEX_API,
            params={
                "search": search_q,
                "per-page": max(limit, 8),
                "sort": "relevance_score:desc"
            },
            headers=headers,
            timeout=3.5
        )
        if resp.status_code == 200:
            for item in resp.json().get("results", []):
                w_id = str(item.get("id") or item.get("doi") or "")
                if w_id and w_id not in seen_ids:
                    seen_ids.add(w_id)
                    combined_raw.append(item)
    except Exception as e:
        logger.debug(f"[ReadingExtractor] Sync OpenAlex General search failed: {e}")

    return _parse_openalex_items(combined_raw) if combined_raw else []


async def _fetch_crossref_candidates_async(client: httpx.AsyncClient, query: str, limit: int) -> List[Dict[str, Any]]:
    clean_title, author, _ = extract_citation_components(query)
    q = f"{clean_title} {author}".strip()
    try:
        resp = await client.get(
            CROSSREF_API,
            params={
                "query.bibliographic": q,
                "rows": max(limit, 5),
                "filter": "type:journal-article,type:proceedings-article,type:book,type:book-chapter"
            },
            headers={"User-Agent": "LectureScribe/1.0 (mailto:academic-research@lecturescribe.local)"}
        )
        if resp.status_code == 200:
            return _parse_crossref_items(resp.json().get("message", {}).get("items", []))
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Async Crossref Search] Exception: {e}")
    return []


async def _fetch_europe_pmc_candidates_async(client: httpx.AsyncClient, query: str, limit: int) -> List[Dict[str, Any]]:
    clean_title, author, _ = extract_citation_components(query)
    q = f'TITLE:"{clean_title}"'
    if author:
        author_word = author.split()[0]
        if len(author_word) >= 3:
            q += f' AUTH:"{author_word}"'
    try:
        resp = await client.get(
            EUROPE_PMC_API,
            params={"query": q, "format": "json", "pageSize": max(limit, 5), "resultType": "core"},
            headers={"User-Agent": "LectureScribe/2.3 (mailto:academic-research@lecturescribe.local)"}
        )
        if resp.status_code == 200:
            return _parse_europe_pmc_items(resp.json().get("resultList", {}).get("result", []))
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Async Europe PMC Search] Exception: {e}")
    return []


async def _fetch_google_books_candidates_async(client: httpx.AsyncClient, query: str, limit: int) -> List[Dict[str, Any]]:
    clean_title, author, _ = extract_citation_components(query)
    q = f"{clean_title} {author}".strip()
    try:
        resp = await client.get(
            GOOGLE_BOOKS_API,
            params={"q": q, "maxResults": min(max(limit, 4), 10), "printType": "books"}
        )
        if resp.status_code == 200:
            return _parse_google_books_items(resp.json().get("items", []))
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Async Google Books Search] Exception: {e}")
    return []


async def _fetch_openalex_candidates_async(
    client: httpx.AsyncClient,
    query: str,
    limit: int,
    expanded_queries: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """
    OpenAlex fetcher supporting both exact titles, landmark citations, and broad topics:
      - Pass 1: Author surname filter + title search sorted by citations (if author supplied)
      - Pass 2: Direct title filter (`title.search`) sorted by `cited_by_count:desc` to surface landmark papers
      - Pass 3: General BM25 search across full text & abstracts for topic exploration
    """
    headers = {"User-Agent": "LectureScribe/2.3 (mailto:academic-research@lecturescribe.local)"}
    clean_title, author, _ = extract_citation_components(query)

    tasks = []

    # Pass 1: Targeted Author filter + Title search
    if author:
        author_surname = author.split()[0].strip()
        tasks.append(
            client.get(
                OPENALEX_API,
                params={
                    "filter": f"title.search:{clean_title},raw_author_name.search:{author_surname}",
                    "per-page": max(limit, 10),
                    "sort": "cited_by_count:desc"
                },
                headers=headers,
                timeout=3.5
            )
        )

    # Pass 2: Direct Title search sorted by citations (guarantees landmark papers like Vaswani 2017 surface)
    tasks.append(
        client.get(
            OPENALEX_API,
            params={
                "filter": f"title.search:{clean_title}",
                "per-page": max(limit, 10),
                "sort": "cited_by_count:desc"
            },
            headers=headers,
            timeout=3.5
        )
    )

    # Pass 3: Broad BM25 query for topics and adjacent literature
    search_q = f"{clean_title} {author}".strip() if author else clean_title
    tasks.append(
        client.get(
            OPENALEX_API,
            params={
                "search": search_q,
                "per-page": max(limit, 15),
                "sort": "relevance_score:desc"
            },
            headers=headers,
            timeout=3.5
        )
    )

    # Pass 4: Topic expansion pass (if expanded_queries supplied)
    if expanded_queries and len(tasks) < 4:
        for eq in expanded_queries:
            clean_eq = eq.strip()
            if clean_eq and clean_eq.lower() not in (clean_title.lower(), search_q.lower()):
                tasks.append(
                    client.get(
                        OPENALEX_API,
                        params={
                            "search": clean_eq,
                            "per-page": max(limit, 10),
                            "sort": "cited_by_count:desc"
                        },
                        headers=headers,
                        timeout=3.5
                    )
                )
                break

    # Cap concurrency to 4 requests
    tasks = tasks[:4]

    try:
        resps = await asyncio.gather(*tasks, return_exceptions=True)
        combined_raw: List[Dict[str, Any]] = []
        seen_ids: Set[str] = set()

        for idx, resp in enumerate(resps):
            if isinstance(resp, httpx.Response) and resp.status_code == 200:
                for item in resp.json().get("results", []):
                    work_id = str(item.get("id") or item.get("doi") or "")
                    if not work_id or work_id not in seen_ids:
                        if work_id:
                            seen_ids.add(work_id)
                        combined_raw.append(item)
            elif isinstance(resp, Exception):
                logger.debug(f"[ReadingExtractor] [Async OpenAlex Pass {idx+1}] Exception: {resp}")

        if combined_raw:
            return _parse_openalex_items(combined_raw)
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Async OpenAlex Multi-Pass Search] Exception: {e}")

    return []


async def _fetch_semantic_scholar_candidates_async(client: httpx.AsyncClient, query: str, limit: int) -> List[Dict[str, Any]]:
    allowed = await _S2_RATE_LIMITER.acquire()
    if not allowed:
        logger.info("[SemanticScholar] [Telemetry] Request rejected by local rate limiter/circuit breaker.")
        return []

    clean_title, author, _ = extract_citation_components(query)
    search_q = f"{clean_title} {author}".strip() if author else clean_title

    try:
        api_key = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")
        headers = {"User-Agent": "LectureScribe/2.2"}
        if api_key:
            headers["x-api-key"] = api_key

        fields = "title,authors,year,citationCount,influentialCitationCount,abstract,openAccessPdf,externalIds,venue"
        resp = await client.get(
            SEMANTIC_SCHOLAR_API,
            params={"query": search_q, "limit": max(limit, 5), "fields": fields},
            headers=headers,
            timeout=3.0
        )
        if resp.status_code == 200:
            _S2_RATE_LIMITER.record_success()
            data = resp.json().get("data", [])
            logger.info(f"[SemanticScholar] [Telemetry] Success (200 OK) retrieved {len(data)} items.")
            return _parse_semantic_scholar_items(data)
        elif resp.status_code == 429:
            _S2_RATE_LIMITER.record_429()
            logger.warning("[SemanticScholar] [Telemetry] HTTP 429 Too Many Requests: circuit breaker tripped.")
            return []
        elif resp.status_code in (401, 403):
            logger.warning(f"[SemanticScholar] [Telemetry] HTTP {resp.status_code} Auth/Forbidden: check SEMANTIC_SCHOLAR_API_KEY.")
            return []
        else:
            logger.warning(f"[SemanticScholar] [Telemetry] HTTP {resp.status_code} unexpected response.")
            return []
    except httpx.TimeoutException:
        logger.warning("[SemanticScholar] [Telemetry] Request timed out after 3.0s.")
        return []
    except Exception as e:
        logger.warning(f"[SemanticScholar] [Telemetry] Network or parsing exception: {e}")
        return []


def _merge_record_metadata(target: Dict[str, Any], incoming: Dict[str, Any]) -> None:
    """Enriches canonical target record with incoming metadata, preferring higher-citation original editions."""
    inc_cit = incoming.get("citation_count") or 0
    tar_cit = target.get("citation_count") or 0
    incoming_is_more_authoritative = inc_cit > tar_cit

    # 1. Citations
    target["citation_count"] = max(tar_cit, inc_cit)
    target["influential_citation_count"] = max(
        target.get("influential_citation_count") or 0, incoming.get("influential_citation_count") or 0
    )

    # 2. If incoming record has more citations (or is original preprint/edition), prefer its core metadata
    if incoming_is_more_authoritative:
        for k in ("doi", "journal", "publisher", "publication_year", "preview_url"):
            if incoming.get(k):
                target[k] = incoming[k]
    else:
        # Keep earliest valid publication year for identical works (original paper vs later reprint)
        yr_t = str(target.get("publication_year") or "")
        yr_i = str(incoming.get("publication_year") or "")
        if yr_t.isdigit() and yr_i.isdigit() and int(yr_i) < int(yr_t):
            target["publication_year"] = yr_i

    # 3. PMCID & PMC Reader
    if incoming.get("pmcid"):
        target["pmcid"] = incoming["pmcid"]
        if not target.get("direct_pdf_url"):
            target["embed_url"] = incoming.get("embed_url") or f"https://europepmc.org/articles/{incoming['pmcid']}"
            target["reader_type"] = "pmc_reader"

    # 4. Direct PDF & arXiv ID
    if incoming.get("arxiv_id") and not target.get("arxiv_id"):
        target["arxiv_id"] = incoming["arxiv_id"]
    if incoming.get("direct_pdf_url") and not target.get("direct_pdf_url"):
        target["direct_pdf_url"] = incoming["direct_pdf_url"]
        target["reader_type"] = "pdf_direct"
        target["embed_url"] = incoming["direct_pdf_url"]

    # 5. Open Access flag
    if incoming.get("is_open_access"):
        target["is_open_access"] = True

    # 6. Abstract - take longer non-empty
    inc_abs = incoming.get("abstract") or ""
    tar_abs = target.get("abstract") or ""
    if len(inc_abs) > len(tar_abs):
        target["abstract"] = inc_abs

    # 7. Fill remaining empty identifiers and bibliographic fields
    for k in ("doi", "journal", "publisher", "publication_year", "preview_url", "isbn", "cover_url"):
        if not target.get(k) and incoming.get(k):
            target[k] = incoming[k]

    if not target.get("embed_url") and incoming.get("embed_url"):
        target["embed_url"] = incoming["embed_url"]
        if incoming.get("reader_type"):
            target["reader_type"] = incoming["reader_type"]


async def _impute_missing_abstract_openalex_async(client: httpx.AsyncClient, doi: str) -> Optional[str]:
    """
    Lightweight lookup in OpenAlex by canonical DOI to recover missing abstracts.
    """
    if not doi:
        return None
    canon_doi = _normalize_doi(doi)
    if not canon_doi:
        return None
    headers = {"User-Agent": "LectureScribe/2.3 (mailto:academic-research@lecturescribe.local)"}
    try:
        url = f"https://api.openalex.org/works/https://doi.org/{canon_doi}"
        resp = await client.get(url, headers=headers, timeout=1.5)
        if resp.status_code == 200:
            data = resp.json()
            inv_index = data.get("abstract_inverted_index")
            if inv_index and isinstance(inv_index, dict):
                return reconstruct_inverted_abstract(inv_index)
    except Exception as e:
        logger.debug(f"[ReadingExtractor] OpenAlex DOI abstract lookup failed for {canon_doi}: {e}")
    return None


def _impute_missing_abstract_openalex_sync(doi: str) -> Optional[str]:
    """
    Synchronous fallback lookup in OpenAlex by canonical DOI.
    """
    if not doi:
        return None
    canon_doi = _normalize_doi(doi)
    if not canon_doi:
        return None
    headers = {"User-Agent": "LectureScribe/2.3 (mailto:academic-research@lecturescribe.local)"}
    try:
        url = f"https://api.openalex.org/works/https://doi.org/{canon_doi}"
        resp = requests.get(url, headers=headers, timeout=1.5)
        if resp.status_code == 200:
            data = resp.json()
            inv_index = data.get("abstract_inverted_index")
            if inv_index and isinstance(inv_index, dict):
                return reconstruct_inverted_abstract(inv_index)
    except Exception as e:
        logger.debug(f"[ReadingExtractor] Sync OpenAlex DOI abstract lookup failed for {canon_doi}: {e}")
    return None


async def _fetch_openalex_doi_metadata(client: httpx.AsyncClient, doi: str, sem: asyncio.Semaphore) -> Optional[Dict[str, Any]]:
    canon_doi = _normalize_doi(doi)
    if not canon_doi:
        return None
    async with sem:
        try:
            resp = await client.get(
                f"https://api.openalex.org/works/https://doi.org/{canon_doi}",
                headers={"User-Agent": "LectureScribe/1.0 (mailto:academic-research@lecturescribe.local)"},
                timeout=2.5
            )
            return resp.json() if resp.status_code == 200 else None
        except Exception as e:
            logger.debug(f"[ReadingExtractor] OpenAlex DOI fetch failed for {canon_doi}: {e}")
            return None


async def _impute_records_abstracts_async(records: List[Dict[str, Any]], client: httpx.AsyncClient) -> None:
    """
    Issue 4: Imputes missing/short (<40 chars) abstracts via OpenAlex DOI lookup,
    or generates synthesized query context string if unavailable.
    Parallelizes OpenAlex DOI lookups with asyncio.gather and bounded concurrency semaphore.
    """
    missing_indices = []
    missing_dois = []
    for idx, r in enumerate(records):
        abstract = r.get("abstract") or ""
        if len(abstract.strip()) < 40:
            doi = r.get("doi")
            missing_indices.append(idx)
            missing_dois.append(doi or "")

    if missing_indices:
        sem = asyncio.Semaphore(5)
        tasks = [
            _fetch_openalex_doi_metadata(client, doi, sem) if doi else asyncio.sleep(0, result=None)
            for doi in missing_dois
        ]
        enriched_results = await asyncio.gather(*tasks, return_exceptions=True)

        for rec_idx, enriched in zip(missing_indices, enriched_results):
            r = records[rec_idx]
            recovered = None
            if isinstance(enriched, dict):
                inv_index = enriched.get("abstract_inverted_index")
                if inv_index and isinstance(inv_index, dict):
                    recovered = reconstruct_inverted_abstract(inv_index)
            if recovered and len(recovered.strip()) >= 40:
                r["abstract"] = recovered
                r["synthesized_context"] = ""
            else:
                title = r.get("title") or "Unknown Title"
                journal = r.get("journal") or r.get("publisher") or "Academic Venue"
                year = r.get("publication_year") or "Recent"
                r["synthesized_context"] = f"Title: {title} | Venue/Journal: {journal} | Year: {year} (Note: Abstract unavailable)"


def _impute_records_abstracts_sync(records: List[Dict[str, Any]]) -> None:
    """
    Issue 4: Synchronous imputation of missing/short (<40 chars) abstracts via OpenAlex DOI lookup,
    or generates synthesized query context string if unavailable.
    """
    for r in records:
        abstract = r.get("abstract") or ""
        if len(abstract.strip()) < 40:
            doi = r.get("doi")
            recovered = None
            if doi:
                recovered = _impute_missing_abstract_openalex_sync(doi)
            if recovered and len(recovered.strip()) >= 40:
                r["abstract"] = recovered
                r["synthesized_context"] = ""
            else:
                title = r.get("title") or "Unknown Title"
                journal = r.get("journal") or r.get("publisher") or "Academic Venue"
                year = r.get("publication_year") or "Recent"
                r["synthesized_context"] = f"Title: {title} | Venue/Journal: {journal} | Year: {year} (Note: Abstract unavailable)"


def _consolidate_and_merge_records(
    crossref_items: Optional[List[Dict[str, Any]]] = None,
    pmc_items: Optional[List[Dict[str, Any]]] = None,
    books_items: Optional[List[Dict[str, Any]]] = None,
    openalex_items: Optional[List[Dict[str, Any]]] = None,
    s2_items: Optional[List[Dict[str, Any]]] = None,
    query: str = ""
) -> List[Dict[str, Any]]:
    """
    Multi-factor deduplication and multi-provider metadata enrichment.
    """
    records: List[Dict[str, Any]] = []

    def _find_duplicate_index(candidate: Dict[str, Any]) -> Optional[int]:
        for i, existing in enumerate(records):
            if _are_records_equivalent(existing, candidate):
                return i
        return None

    # Step 1: Ingest OpenAlex (Tier-1 Primary Foundation)
    for oa_item in (openalex_items or []):
        if _find_duplicate_index(oa_item) is None:
            records.append(dict(oa_item))

    # Step 2: Ingest Semantic Scholar (enrich with citation metrics & S2 metadata)
    for s2_item in (s2_items or []):
        match_idx = _find_duplicate_index(s2_item)
        if match_idx is not None:
            _merge_record_metadata(records[match_idx], s2_item)
        else:
            records.append(dict(s2_item))

    # Step 3: Ingest Crossref results
    for cr_item in (crossref_items or []):
        match_idx = _find_duplicate_index(cr_item)
        if match_idx is not None:
            _merge_record_metadata(records[match_idx], cr_item)
        else:
            records.append(dict(cr_item))

    # Step 4: Ingest Europe PMC results with enrichment
    for pmc_item in (pmc_items or []):
        match_idx = _find_duplicate_index(pmc_item)
        if match_idx is not None:
            _merge_record_metadata(records[match_idx], pmc_item)
        else:
            records.append(dict(pmc_item))

    # Step 5: Ingest Google Books results
    for b_item in (books_items or []):
        match_idx = _find_duplicate_index(b_item)
        if match_idx is not None:
            _merge_record_metadata(records[match_idx], b_item)
        else:
            records.append(dict(b_item))

    # Ensure all canonical fields and compute hybrid relevance scores
    for r in records:
        r.setdefault("citation_count", 0)
        r.setdefault("influential_citation_count", 0)
        r.setdefault("direct_pdf_url", "")
        r.setdefault("arxiv_id", "")
        r.setdefault("pmcid", "")
        r.setdefault("isbn", "")
        r.setdefault("cover_url", "")
        r.setdefault("preview_url", "")
        r.setdefault("embed_url", "")
        r.setdefault("reader_type", "web")
        r.setdefault("publisher", "")
        r.setdefault("journal", "")
        r.setdefault("doi", "")
        r.setdefault("is_open_access", False)

        # Post-enrichment normalizer: auto-populate arxiv_id if empty but link points to arXiv
        if not r.get("arxiv_id"):
            found_arxiv = (
                extract_canonical_arxiv_id(r.get("direct_pdf_url")) or
                extract_canonical_arxiv_id(r.get("preview_url")) or
                extract_canonical_arxiv_id(r.get("embed_url")) or
                extract_canonical_arxiv_id(r.get("doi"))
            )
            if found_arxiv:
                r["arxiv_id"] = found_arxiv

        r["relevance_score"] = compute_hybrid_relevance(r, query)

    return records


class SLMQueryPlanner:
    """
    Stage 1 SLM Query Planner & Intent Router.
    Analyzes user query and course context to generate:
      - Canonical domain classification ('cs_ai', 'biomedical', 'physics_math', 'humanities_social')
      - Up to 3 prioritized primary query variations
      - Filtered provider selection
      - Intent ('paper', 'monograph', 'general')
      - Excluded concepts
    Enforces strict query budgets:
      - Semantic Scholar & arXiv: Only first/primary query string. Never multi-query fan-out.
      - OpenAlex & Europe PMC: Max concurrency cap of 3 requests with polite headers.
    """
    @classmethod
    def _heuristic_fallback_plan(cls, query: str, course_name: str = "") -> Dict[str, Any]:
        clean_title, author, _ = extract_citation_components(query)
        intent = _classify_query_intent(query)
        domain = DomainRouter.classify_domain(course_name, clean_title)
        dispatched_providers, _ = DomainRouter.get_providers_for_domain(domain, clean_title)

        primary_queries = [clean_title]

        return {
            "domain": str(domain).lower(),
            "verbatim_query": clean_title,
            "author_filter": author,
            "foundational_nomenclature": clean_title,
            "architectural_class": "",
            "negative_disambiguation": [],
            "primary_query": clean_title,
            "expanded_queries": [],
            "primary_queries": primary_queries[:3],
            "providers": dispatched_providers,
            "intent": intent,
            "negative_concepts": [],
            "excluded_concepts": []
        }

    @classmethod
    def plan(cls, query: str, course_name: str = "") -> Dict[str, Any]:
        """Synchronous wrapper for query planning (uses heuristic fallback)."""
        return cls._heuristic_fallback_plan(query, course_name)

    @classmethod
    async def plan_async(cls, query: str, course_name: str = "", timeout: float = 1.5) -> Dict[str, Any]:
        """
        Stage 1 Neural SLM Query Planner & Intent Router.
        Invokes fast SLM (Groq llama-3.1-8b-instant or Gemini Flash Lite) to dynamically produce
        domain classification, primary query expansions, provider dispatch, and negative concepts.
        Falls back seamlessly to _heuristic_fallback_plan if keys are missing or timeout occurs.
        """
        clean_title, author, _ = extract_citation_components(query)
        fallback = cls._heuristic_fallback_plan(query, course_name)

        groq_key = os.getenv("GROQ_API_KEY", "")
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        openai_key = os.getenv("OPENAI_API_KEY", "")

        if not (groq_key or gemini_key or openai_key):
            return fallback

        system_prompt = (
            "You are a strict Stage 1 Academic Query Planner & Intent Router for university research.\n"
            f"Course context: '{course_name or 'General Academic'}'\n\n"
            "Given the user query, identify whether it is a topic, specific book title, or research paper citation. "
            "Output ONLY a valid JSON object conforming to:\n"
            "{\n"
            '  "verbatim_query": "<pure document or book title, or topic, WITHOUT author or et al. tokens>",\n'
            '  "author_filter": "<primary author surname if mentioned in query, else \\"\\">",\n'
            '  "foundational_nomenclature": "<historical or formal technical terminology under which the mechanism was originally published, e.g. self-attention mechanism>",\n'
            '  "architectural_class": "<broader paradigm or domain, e.g. transformer architectures>",\n'
            '  "negative_disambiguation": ["<false collision 1>", "<false collision 2>"],\n'
            '  "domain": "cs_ai" | "biomedical" | "physics_math" | "humanities_social",\n'
            '  "providers": ["openalex", "crossref", "semantic_scholar", "google_books"],\n'
            '  "intent": "paper" | "monograph" | "general"\n'
            "}\n"
            "Rules:\n"
            "1. Strip citation markers like 'Vaswani et al.', 'He et al. 2016', or 'by Martin Kleppmann' from verbatim_query.\n"
            "2. If query mentions a textbook or book title (e.g., 'Designing Data-Intensive Applications', 'Pattern Recognition and Machine Learning'), set intent to 'monograph' and ensure 'google_books' is in providers.\n"
            "3. If query is a topic (e.g. 'Self-Attention Mechanisms', 'Distributed Consensus'), provide 1-2 authoritative canonical equivalents in foundational_nomenclature.\n"
            "4. If domain is STEM Computer Science / AI, DO NOT include 'europe_pmc' in 'providers'. Include 'openalex' and 'semantic_scholar'.\n"
            "5. If domain is Biomedical / Clinical, include 'europe_pmc', 'openalex', and 'crossref'.\n"
            "6. Return ONLY the raw JSON object. No markdown, no fences, no explanation."
        )

        user_prompt = f"User Query: {query}"

        try:
            raw_response = None
            if groq_key:
                from openai import AsyncOpenAI
                g_client = AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=groq_key)
                groq_models = [
                    os.getenv("GROQ_SLM_MODEL", "").strip(),
                    "qwen/qwen3.8-27b",
                    "llama-3.3-70b-versatile",
                    "llama-3.1-8b-instant",
                ]
                groq_models = [m for m in groq_models if m]
                for g_model in groq_models:
                    try:
                        resp = await asyncio.wait_for(
                            g_client.chat.completions.create(
                                model=g_model,
                                messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
                                max_tokens=250,
                                temperature=0.0
                            ),
                            timeout=timeout
                        )
                        raw_response = resp.choices[0].message.content or ""
                        if raw_response:
                            break
                    except Exception as err:
                        status = getattr(err, "status_code", None)
                        body = getattr(err, "response", None)
                        body_text = getattr(body, "text", "") if body else getattr(err, "message", str(err))
                        logger.warning(
                            f"[SLMQueryPlanner] Groq model '{g_model}' failed (status={status}): {body_text}"
                        )
            elif gemini_key:
                from openai import AsyncOpenAI
                gem_client = AsyncOpenAI(base_url="https://generativelanguage.googleapis.com/v1beta/openai/", api_key=gemini_key)
                resp = await asyncio.wait_for(
                    gem_client.chat.completions.create(
                        model="gemini-flash-lite-latest",
                        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
                        max_tokens=250,
                        temperature=0.0
                    ),
                    timeout=timeout
                )
                raw_response = resp.choices[0].message.content or ""

            if raw_response:
                clean_raw = re.sub(r"^```(?:json)?\s*", "", raw_response.strip())
                clean_raw = re.sub(r"\s*```$", "", clean_raw).strip()
                data = json.loads(clean_raw)
                if isinstance(data, dict):
                    domain = data.get("domain") or fallback["domain"]

                    verbatim_q = data.get("verbatim_query")
                    if not isinstance(verbatim_q, str) or not verbatim_q.strip():
                        verbatim_q = data.get("primary_query") or clean_title
                    verbatim_q = str(verbatim_q).strip()

                    auth = str(data.get("author_filter") or author).strip()

                    foundational_nom = data.get("foundational_nomenclature")
                    if not isinstance(foundational_nom, str) or not foundational_nom.strip():
                        exps = data.get("expanded_queries")
                        foundational_nom = str(exps[0]).strip() if (isinstance(exps, list) and exps) else ""
                    foundational_nom = str(foundational_nom).strip()

                    arch_class = str(data.get("architectural_class") or "").strip()

                    neg_disambig = data.get("negative_disambiguation")
                    if not isinstance(neg_disambig, list):
                        neg_disambig = data.get("negative_concepts") or data.get("excluded_concepts") or []
                    negative_disambiguation = [str(x).strip() for x in neg_disambig if str(x).strip()]

                    pri_q = verbatim_q.strip('"').strip() or clean_title
                    expanded_queries: List[str] = []
                    if foundational_nom and foundational_nom.lower() != pri_q.lower():
                        expanded_queries.append(foundational_nom)
                    if arch_class and arch_class.lower() != pri_q.lower() and arch_class not in expanded_queries:
                        expanded_queries.append(arch_class)
                    legacy_exps = data.get("expanded_queries")
                    if isinstance(legacy_exps, list):
                        for eq in legacy_exps:
                            s_eq = str(eq).strip()
                            if s_eq and s_eq.lower() != pri_q.lower() and s_eq not in expanded_queries:
                                expanded_queries.append(s_eq)
                    expanded_queries = expanded_queries[:2]

                    primary_queries = [pri_q] + expanded_queries

                    providers = data.get("providers")
                    if not isinstance(providers, list) or not providers:
                        providers = fallback["providers"]
                    else:
                        if domain in ("cs_ai", "stem_cs") and "europe_pmc" in providers:
                            providers = [p for p in providers if p != "europe_pmc"]
                        valid_providers = {"openalex", "crossref", "europe_pmc", "google_books", "semantic_scholar"}
                        providers = [p for p in providers if p in valid_providers]
                        if not providers:
                            providers = fallback["providers"]

                    intent = data.get("intent")
                    if intent not in ("paper", "monograph", "general"):
                        intent = fallback["intent"]

                    return {
                        "domain": domain,
                        "verbatim_query": verbatim_q,
                        "author_filter": auth,
                        "foundational_nomenclature": foundational_nom,
                        "architectural_class": arch_class,
                        "negative_disambiguation": negative_disambiguation,
                        "primary_query": pri_q,
                        "expanded_queries": expanded_queries,
                        "primary_queries": primary_queries[:3],
                        "providers": providers,
                        "intent": intent,
                        "negative_concepts": negative_disambiguation,
                        "excluded_concepts": negative_disambiguation
                    }
        except Exception as e:
            logger.debug(f"[SLMQueryPlanner] SLM query planning timed out or failed ({e}); falling back to heuristic planner.")

        return fallback


class SLMReranker:
    """
    Stage 4 SLM Semantic Judge and Reranker (Issue 2).
    Evaluates top bounded candidates (max N=8) with compact context representation.
    Falls back gracefully to BM25/lexical hybrid scoring when LLM is unavailable or times out.
    """
    MAX_CANDIDATE_POOL = 8
    MAX_ABSTRACT_CHARS = 600
    MAX_ABSTRACT_WORDS = 120

    @classmethod
    def format_candidate_context(cls, candidate: Dict[str, Any], candidate_id: int) -> str:
        """
        Formats candidate into a concise evaluation context.
        Truncates abstracts to <= 600 chars or 120 words (Issue 2).
        If abstract is missing (< 40 chars), synthesizes fallback context string (Issue 4).
        """
        title = candidate.get("title") or "Unknown Title"
        author = candidate.get("author") or "Unknown Author"
        journal = candidate.get("journal") or candidate.get("publisher") or "Academic Venue"
        year = candidate.get("publication_year") or "Recent"
        abstract = candidate.get("abstract") or ""

        if not abstract or len(abstract.strip()) < 40:
            abstract_text = candidate.get("synthesized_context") or f"Title: {title} | Author: {author} | Venue/Journal: {journal} | Year: {year} (Note: Abstract unavailable)"
        else:
            clean_abstract = " ".join(abstract.split())
            words = clean_abstract.split(" ")
            truncated = False
            if len(words) > cls.MAX_ABSTRACT_WORDS:
                clean_abstract = " ".join(words[:cls.MAX_ABSTRACT_WORDS])
                truncated = True
            if len(clean_abstract) > cls.MAX_ABSTRACT_CHARS:
                clean_abstract = clean_abstract[:cls.MAX_ABSTRACT_CHARS].rstrip()
                truncated = True
            if truncated and not clean_abstract.endswith("..."):
                clean_abstract = clean_abstract.rstrip() + "..."
            abstract_text = clean_abstract

        return f"[{candidate_id}] Title: {title} by {author} ({year}) | Venue: {journal}\nAbstract: {abstract_text}"

    @classmethod
    def prune_candidates(cls, candidates: List[Dict[str, Any]], max_n: int = 8) -> List[Dict[str, Any]]:
        """
        Uses preliminary lexical/hybrid relevance scores to bound the candidate pool to top N (max 8) (Issue 2).
        """
        if len(candidates) <= max_n:
            return list(candidates)
        sorted_candidates = sorted(candidates, key=lambda c: c.get("relevance_score", 0.0), reverse=True)
        return sorted_candidates[:max_n]

    @classmethod
    def _parse_scores(cls, raw: str) -> Dict[int, float]:
        """
        Parses simplified compact schema: [ {"candidate_id": int, "semantic_score": float} ]
        """
        res: Dict[int, float] = {}
        try:
            clean = re.sub(r"^```(?:json)?\s*", "", raw.strip())
            clean = re.sub(r"\s*```$", "", clean).strip()
            data = json.loads(clean)
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and "candidate_id" in item and "semantic_score" in item:
                        cid = int(item["candidate_id"])
                        score = float(item["semantic_score"])
                        res[cid] = min(1.0, max(0.0, score))
        except Exception:
            pass
        return res

    @classmethod
    async def rerank_async(
        cls,
        candidates: List[Dict[str, Any]],
        query: str,
        course_name: str = "",
        timeout: float = 1.5,
        negative_disambiguation: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Reranks top N candidates using an SLM / LLM judge.
        Returns candidates with updated 'relevance_score' blended from 'semantic_score'.
        """
        if not candidates:
            return []

        clean_title, author_filter, _ = extract_citation_components(query)
        bounded = cls.prune_candidates(candidates, max_n=cls.MAX_CANDIDATE_POOL)

        groq_key = os.getenv("GROQ_API_KEY", "")
        gemini_key = os.getenv("GEMINI_API_KEY", "")
        openai_key = os.getenv("OPENAI_API_KEY", "")

        if not (groq_key or gemini_key or openai_key):
            return bounded

        candidate_blocks = [cls.format_candidate_context(c, i) for i, c in enumerate(bounded)]
        prompt_text = "\n\n".join(candidate_blocks)

        disambig_note = ""
        if negative_disambiguation:
            disambig_note = f"\n- < 0.40 (Irrelevant / Token Collision): Drop threshold. Superficially matches keywords or affixes ({negative_disambiguation}) but represents an unrelated mechanism."
        else:
            disambig_note = "\n- < 0.40 (Irrelevant / Token Collision): Drop threshold. Superficially matches keywords or affixes but represents an unrelated mechanism."

        system_msg = (
            f"You are a strict academic literature relevance evaluator for the course '{course_name or 'General Academic'}'.\n"
            f"User Query: '{query}' (Target Title/Topic: '{clean_title}', Target Author: '{author_filter}')\n\n"
            "Evaluate each numbered candidate against the following strict academic scoring rubric strictly between 0.0 and 1.0:\n"
            "- 0.95 – 1.00 (Core Architectural Breakthrough / Direct Focus / Exact Work): The exact paper or textbook requested by the user, or seminal work defining the queried topic.\n"
            "- 0.75 – 0.94 (Substantial Application / Integrated Module / Authoritative Textbook): The paper/textbook directly addresses the query topic or uses the queried mechanism centrally.\n"
            "- 0.45 – 0.74 (Marginal / Variant / Derivative Usage): The paper uses a tangential, spatial-only, or non-standard variant or minor downstream evaluation.\n"
            f"{disambig_note.strip()}\n\n"
            "Instruction Directive:\n"
            "Do not cluster scores around 0.80–0.85. Actively differentiate between papers whose central theoretical contribution is the queried mechanism versus those that merely apply it as a sub-component.\n\n"
            "Respond ONLY with a valid JSON array of objects with keys 'candidate_id' and 'semantic_score'. "
            "Do NOT include any explanations, markdown or extra text.\n"
            "Example: [{\"candidate_id\": 0, \"semantic_score\": 0.95}]"
        )

        try:
            raw_response = None
            if groq_key:
                from openai import AsyncOpenAI
                g_client = AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=groq_key)
                groq_models = [
                    os.getenv("GROQ_SLM_MODEL", "").strip(),
                    "qwen/qwen3.8-27b",
                    "llama-3.3-70b-versatile",
                    "llama-3.1-8b-instant",
                ]
                groq_models = [m for m in groq_models if m]
                for g_model in groq_models:
                    try:
                        resp = await asyncio.wait_for(
                            g_client.chat.completions.create(
                                model=g_model,
                                messages=[{"role": "system", "content": system_msg}, {"role": "user", "content": prompt_text}],
                                max_tokens=300,
                                temperature=0.0
                            ),
                            timeout=timeout
                        )
                        raw_response = resp.choices[0].message.content or ""
                        if raw_response:
                            break
                    except Exception as err:
                        status = getattr(err, "status_code", None)
                        body = getattr(err, "response", None)
                        body_text = getattr(body, "text", "") if body else getattr(err, "message", str(err))
                        logger.warning(
                            f"[SLMReranker] Groq model '{g_model}' failed (status={status}): {body_text}"
                        )
            elif gemini_key:
                from openai import AsyncOpenAI
                gem_client = AsyncOpenAI(base_url="https://generativelanguage.googleapis.com/v1beta/openai/", api_key=gemini_key)
                resp = await asyncio.wait_for(
                    gem_client.chat.completions.create(
                        model="gemini-flash-lite-latest",
                        messages=[{"role": "system", "content": system_msg}, {"role": "user", "content": prompt_text}],
                        max_tokens=300,
                        temperature=0.0
                    ),
                    timeout=timeout
                )
                raw_response = resp.choices[0].message.content or ""

            if raw_response:
                scores_map = cls._parse_scores(raw_response)
                MIN_SEMANTIC_SCORE_FLOOR = 0.40
                scored_candidates: List[Dict[str, Any]] = []

                norm_clean = _normalize_title(clean_title)

                for idx, c in enumerate(bounded):
                    if idx in scores_map:
                        sem_score = scores_map[idx]
                        c["semantic_score"] = sem_score

                        # Exact title match guarantee
                        if norm_clean and norm_clean == _normalize_title(c.get("title", "")):
                            sem_score = max(sem_score, 0.98)
                            c["semantic_score"] = sem_score

                        # HARD FILTER: Citation count must NEVER compensate for zero or near-zero semantic alignment
                        if sem_score < MIN_SEMANTIC_SCORE_FLOOR:
                            continue
                        citations = max(0, int(c.get("citation_count") or 0))
                        s_cit = min(1.0, math.log10(1.0 + citations) / 4.0)
                        current_year = datetime.now().year
                        pub_year_str = str(c.get("publication_year") or "")
                        pub_year = int(pub_year_str) if pub_year_str.isdigit() else (current_year - 5)
                        delta_y = max(0, current_year - pub_year)
                        s_rec = max(0.25, min(1.0, math.exp(-delta_y / 14.0)))

                        computed_rel = round(min(1.0, max(0.0, 0.55 * sem_score + 0.30 * s_cit + 0.15 * s_rec)), 4)
                        if norm_clean and norm_clean == _normalize_title(c.get("title", "")):
                            computed_rel = max(computed_rel, 0.95)

                        c["relevance_score"] = computed_rel
                        scored_candidates.append(c)

                return scored_candidates
        except Exception as e:
            logger.debug(f"[SLMReranker] SLM reranking failed or timed out ({e}); preserving BM25/hybrid fallback.")

        return bounded

    @classmethod
    def rerank(
        cls,
        candidates: List[Dict[str, Any]],
        query: str,
        course_name: str = ""
    ) -> List[Dict[str, Any]]:
        return cls.prune_candidates(candidates, max_n=cls.MAX_CANDIDATE_POOL)


def _adaptive_interleave(
    papers: List[Dict[str, Any]],
    books: List[Dict[str, Any]],
    limit: int,
    query: str = "",
    min_book_relevance: Optional[float] = None
) -> List[Dict[str, Any]]:
    """
    Dynamically balances result slots based on detected query intent.
    Guarantees monograph visibility while preventing paper citation pollution.
    Enforces monograph relevancy floor when min_book_relevance is specified (Issue 5).
    """
    if limit <= 0:
        return []

    valid_books = books
    if min_book_relevance is not None and min_book_relevance > 0.0:
        valid_books = [
            b for b in books
            if ("relevance_score" not in b and "semantic_score" not in b)
            or b.get("semantic_score", b.get("relevance_score", 1.0)) >= min_book_relevance
        ]

    if not valid_books:
        return papers[:limit]
    if not papers:
        return valid_books[:limit]

    intent = _classify_query_intent(query)
    if intent == "monograph":
        target_books = min(len(valid_books), max(1, int(limit * 0.7)))
        target_papers = limit - target_books
    elif intent == "paper":
        target_books = min(len(valid_books), 1) if limit >= 5 else 0
        target_papers = limit - target_books
    else:
        target_books = min(len(valid_books), 2) if limit >= 4 else (min(len(valid_books), 1) if limit >= 2 else 0)
        target_papers = limit - target_books

    selected_books = valid_books[:target_books]
    selected_papers = papers[:target_papers]

    rem_slots = limit - (len(selected_books) + len(selected_papers))
    if rem_slots > 0:
        if len(papers) > target_papers:
            selected_papers.extend(papers[target_papers : target_papers + rem_slots])
        elif len(valid_books) > target_books:
            selected_books.extend(valid_books[target_books : target_books + rem_slots])

    combined: List[Dict[str, Any]] = []
    if intent == "monograph":
        b_idx, p_idx = 0, 0
        while b_idx < len(selected_books) or p_idx < len(selected_papers):
            if b_idx < len(selected_books):
                combined.append(selected_books[b_idx])
                b_idx += 1
            if p_idx < len(selected_papers):
                combined.append(selected_papers[p_idx])
                p_idx += 1
    else:
        p_idx, b_idx = 0, 0
        while p_idx < len(selected_papers) or b_idx < len(selected_books):
            for _ in range(2):
                if p_idx < len(selected_papers):
                    combined.append(selected_papers[p_idx])
                    p_idx += 1
            if b_idx < len(selected_books):
                combined.append(selected_books[b_idx])
                b_idx += 1

    return combined[:limit]


def _interleave_results(
    papers: List[Dict[str, Any]],
    books: List[Dict[str, Any]],
    limit: int
) -> List[Dict[str, Any]]:
    """Backward-compatible helper alias for standard balanced interleaving."""
    return _adaptive_interleave(papers, books, limit, query="")


def _format_and_interleave(
    records: List[Dict[str, Any]],
    limit: int,
    query: str = "",
    min_book_relevance: Optional[float] = None,
    course_name: str = ""
) -> List[Dict[str, Any]]:
    """
    Formats, sorts, and adaptively interleaves candidates.
    Enforces strict monograph relevancy floor when min_book_relevance
    is specified or course context is provided (Issue 5).
    """
    floor = min_book_relevance
    if floor is None:
        floor = 0.40 if course_name else 0.0

    books = [
        r for r in records
        if r.get("reading_type") == "book" and (
            floor <= 0.0 or
            ("relevance_score" not in r and "semantic_score" not in r) or
            r.get("semantic_score", r.get("relevance_score", 0.0)) >= floor
        )
    ]
    papers = [
        r for r in records
        if r.get("reading_type") != "book" and (
            "semantic_score" not in r or r["semantic_score"] is None or r["semantic_score"] >= 0.40
        )
    ]
    papers.sort(key=lambda x: x.get("relevance_score", 0.0), reverse=True)
    books.sort(key=lambda x: x.get("relevance_score", 0.0), reverse=True)
    return _adaptive_interleave(papers, books, limit=limit, query=query, min_book_relevance=floor)


async def search_academic_literature_async(query: str, limit: int = 6, course_name: str = "") -> List[Dict[str, Any]]:
    """
    Asynchronous federated literature discovery across OpenAlex (Tier 1),
    Crossref, Europe PMC, Google Books, and Semantic Scholar (rate-limited).
    Handles exact paper citations, specific book titles, and general topics.
    """
    if not query or len(query.strip()) < 2:
        return []

    clean_title, author, _ = extract_citation_components(query)
    logger.info(f"[ReadingExtractor] Searching academic literature & books async for: '{clean_title}' (author='{author}', limit={limit}, course='{course_name}')")

    # Stage 1: Neural SLM Query Planner & Budgeted Provider Routing
    plan = await SLMQueryPlanner.plan_async(query, course_name)
    dispatched = plan.get("providers", [])
    primary_q = plan.get("primary_query") or clean_title
    expanded_queries = plan.get("expanded_queries") or []

    client = get_async_http_client()
    task_keys: List[str] = []
    tasks = []

    if "openalex" in dispatched:
        task_keys.append("openalex")
        # OpenAlex searches primary query (relevance + citations) + expanded query variations up to concurrency cap of 4
        tasks.append(asyncio.create_task(_fetch_openalex_candidates_async(client, query, limit, expanded_queries=expanded_queries)))

    if "crossref" in dispatched:
        task_keys.append("crossref")
        tasks.append(asyncio.create_task(_fetch_crossref_candidates_async(client, query, limit)))

    if "europe_pmc" in dispatched:
        task_keys.append("europe_pmc")
        tasks.append(asyncio.create_task(_fetch_europe_pmc_candidates_async(client, query, limit)))

    if "google_books" in dispatched:
        task_keys.append("google_books")
        tasks.append(asyncio.create_task(_fetch_google_books_candidates_async(client, query, limit)))

    if "semantic_scholar" in dispatched:
        # Check circuit breaker before issuing network task: skip instantly if tripped
        if not _S2_RATE_LIMITER.is_circuit_open():
            task_keys.append("semantic_scholar")
            # S2 query budget: Execute queries using ONLY the first/primary query string (Issue 3)
            tasks.append(asyncio.create_task(_fetch_semantic_scholar_candidates_async(client, query, limit)))
        else:
            logger.info("[ReadingExtractor] S2 circuit breaker is open. Bypassing S2 fetch immediately.")

    raw_results = await asyncio.gather(*tasks, return_exceptions=True) if tasks else []

    results_map: Dict[str, List[Dict[str, Any]]] = {}
    for key, res in zip(task_keys, raw_results):
        if isinstance(res, list):
            results_map[key] = res
        else:
            logger.debug(f"[ReadingExtractor] Provider {key} task failed with error: {res}")
            results_map[key] = []

    consolidated = _consolidate_and_merge_records(
        crossref_items=results_map.get("crossref", []),
        pmc_items=results_map.get("europe_pmc", []),
        books_items=results_map.get("google_books", []),
        openalex_items=results_map.get("openalex", []),
        s2_items=results_map.get("semantic_scholar", []),
        query=query
    )

    # Issue 4: Impute missing abstracts asynchronously via OpenAlex DOI lookup
    await _impute_records_abstracts_async(consolidated, client)
    for r in consolidated:
        r["relevance_score"] = compute_hybrid_relevance(r, query)

    # Issue 2: Prune candidates to top N (max 8) and invoke SLM reranker
    bounded = SLMReranker.prune_candidates(consolidated, max_n=8)
    neg_disambig = plan.get("negative_disambiguation") or plan.get("negative_concepts") or []
    reranked = await SLMReranker.rerank_async(
        bounded,
        query,
        course_name=course_name,
        negative_disambiguation=neg_disambig
    )

    # Stage 5 Hard semantic floor post-filter: drop any candidate with semantic_score < 0.40
    # Citation count must NEVER compensate for zero or near-zero semantic alignment
    MIN_SEMANTIC_SCORE_FLOOR = 0.40
    filtered_reranked = [
        item for item in reranked
        if ("semantic_score" not in item or item["semantic_score"] is None or item["semantic_score"] >= MIN_SEMANTIC_SCORE_FLOOR)
    ]

    # Issue 5: Format and interleave enforcing monograph relevancy floor
    floor = 0.40 if course_name else 0.0
    final_results = _format_and_interleave(filtered_reranked, limit=limit, query=query, min_book_relevance=floor, course_name=course_name)
    logger.info(f"[ReadingExtractor] search_academic_literature_async returned {len(final_results)} results for query: '{query}'")
    return final_results


def search_academic_literature(query: str, limit: int = 6, course_name: str = "") -> List[Dict[str, Any]]:
    """
    Synchronous federated literature discovery entrypoint.
    Queries OpenAlex, Crossref, Europe PMC, and Google Books concurrently.
    Uses DomainRouter to strictly exclude non-applicable providers.
    """
    if not query or len(query.strip()) < 2:
        return []

    clean_title, author, _ = extract_citation_components(query)
    logger.info(f"[ReadingExtractor] Searching academic literature & books for: '{clean_title}' (author='{author}', limit={limit}, course='{course_name}')")

    plan = SLMQueryPlanner.plan(query, course_name)
    dispatched = plan.get("providers", [])

    oa_items: List[Dict[str, Any]] = []
    cr_items: List[Dict[str, Any]] = []
    pmc_items: List[Dict[str, Any]] = []
    gb_items: List[Dict[str, Any]] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {}
        if "openalex" in dispatched:
            futures["openalex"] = executor.submit(_fetch_openalex_candidates, query, limit)
        if "crossref" in dispatched:
            futures["crossref"] = executor.submit(_fetch_crossref_candidates, query, limit)
        if "europe_pmc" in dispatched:
            futures["europe_pmc"] = executor.submit(_fetch_europe_pmc_candidates, query, limit)
        if "google_books" in dispatched:
            futures["google_books"] = executor.submit(_fetch_google_books_candidates, query, limit)

        if "openalex" in futures:
            try:
                oa_items = futures["openalex"].result()
            except Exception as e:
                logger.debug(f"[ReadingExtractor] OpenAlex query error: {e}")

        if "crossref" in futures:
            try:
                cr_items = futures["crossref"].result()
            except Exception as e:
                logger.debug(f"[ReadingExtractor] Crossref query error: {e}")

        if "europe_pmc" in futures:
            try:
                pmc_items = futures["europe_pmc"].result()
            except Exception as e:
                logger.debug(f"[ReadingExtractor] Europe PMC query error: {e}")

        if "google_books" in futures:
            try:
                gb_items = futures["google_books"].result()
            except Exception as e:
                logger.debug(f"[ReadingExtractor] Google Books query error: {e}")

    consolidated = _consolidate_and_merge_records(
        crossref_items=cr_items,
        pmc_items=pmc_items,
        books_items=gb_items,
        openalex_items=oa_items,
        query=query
    )

    _impute_records_abstracts_sync(consolidated)
    for r in consolidated:
        r["relevance_score"] = compute_hybrid_relevance(r, query)

    bounded = SLMReranker.prune_candidates(consolidated, max_n=8)
    floor = 0.40 if course_name else 0.0
    final_results = _format_and_interleave(bounded, limit=limit, query=query, min_book_relevance=floor, course_name=course_name)
    logger.info(f"[ReadingExtractor] search_academic_literature returned {len(final_results)} results for query: '{query}'")
    return final_results


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
        logger.debug("[ReadingExtractor] _parse_readings_json received empty string.")
        return []
    clean_str = re.sub(r"^```(?:json)?\s*", "", raw_json_str.strip())
    clean_str = re.sub(r"\s*```$", "", clean_str).strip()
    logger.debug(f"[ReadingExtractor] Parsing LLM output ({len(clean_str)} chars). Snippet: {clean_str[:200]!r}")

    # 1. Direct parse (Array or Dict wrapper)
    try:
        parsed = json.loads(clean_str)
        if isinstance(parsed, list):
            logger.info(f"[ReadingExtractor] Direct JSON parse succeeded: array with {len(parsed)} items.")
            return parsed
        if isinstance(parsed, dict):
            for k in ("readings", "books", "items", "results"):
                if isinstance(parsed.get(k), list):
                    items = parsed[k]
                    logger.info(f"[ReadingExtractor] Direct JSON parse succeeded: key '{k}' with {len(items)} items.")
                    return items
    except Exception as e:
        logger.debug(f"[ReadingExtractor] Direct JSON parse failed: {e}")

    # 2. Try completing truncated JSON with standard closures
    for suffix in ["]", "}]", "\"\n}]", "\"}]", "}\n]"]:
        try:
            parsed = json.loads(clean_str + suffix)
            if isinstance(parsed, list):
                logger.info(f"[ReadingExtractor] Recovered truncated JSON with suffix '{suffix}': {len(parsed)} items.")
                return parsed
            if isinstance(parsed, dict):
                for k in ("readings", "books", "items", "results"):
                    if isinstance(parsed.get(k), list):
                        items = parsed[k]
                        logger.info(f"[ReadingExtractor] Recovered truncated JSON with key '{k}' ({suffix}): {len(items)} items.")
                        return items
        except Exception:
            continue

    # 3. Regex fallback: extract any individually complete object with a title field
    logger.debug("[ReadingExtractor] Trying regex fallback for individual JSON objects with 'title'...")
    extracted = []
    object_matches = re.finditer(r'\{[^{}]*\"title\"\s*:\s*\"[^\"]+\"[^{}]*\}', clean_str)
    for m in object_matches:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict) and obj.get("title"):
                extracted.append(obj)
        except Exception:
            continue

    if extracted:
        logger.info(f"[ReadingExtractor] Regex fallback recovered {len(extracted)} valid reading objects.")
    else:
        logger.warning(f"[ReadingExtractor] All JSON parsing strategies failed to find reading objects in raw output: {clean_str[:300]!r}")
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

    logger.info(
        f"[ReadingExtractor] extract_readings_with_llm invoked for course='{course_name}'. "
        f"Transcripts len={len(transcripts_summary)}, Slides len={len(slides_text)}. "
        f"Available keys: Groq={bool(groq_key)}, Gemini={bool(gemini_key)}, OpenAI={bool(openai_key)}, OpenAI_Base={bool(openai_base)}"
    )

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
        f"--- LECTURE TRANSCRIPTS EXCERPTS ---\n{transcripts_summary[:100000]}\n\n"
        f"--- PROFESSOR SLIDE DECKS TEXT ---\n{slides_text[:25000]}\n\n"
        "Extracted Readings JSON:"
    )

    items: List[Dict[str, Any]] = []

    # 1. Try Groq (verified active models on Groq API)
    if groq_key:
        logger.info("[ReadingExtractor] Attempting LLM extraction via Groq...")
        from openai import OpenAI
        groq_client = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=groq_key)
        groq_candidates = [
            os.getenv("GROQ_DEFAULT_MODEL", "").strip(),
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "qwen/qwen3.8-27b",
        ]
        groq_candidates = [m for m in groq_candidates if m]
        for g_model in groq_candidates:
            try:
                logger.info(f"[ReadingExtractor] Invoking Groq model '{g_model}'...")
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
                logger.info(f"[ReadingExtractor] Groq model '{g_model}' responded with {len(raw_out)} chars.")
                parsed = _parse_readings_json(raw_out)
                if parsed:
                    items = parsed
                    logger.info(f"[ReadingExtractor] Groq model '{g_model}' successfully produced {len(items)} readings.")
                    break
                else:
                    logger.info(f"[ReadingExtractor] Groq model '{g_model}' returned 0 parsed readings (empty result).")
            except Exception as e:
                status = getattr(e, "status_code", None)
                body = getattr(e, "response", None)
                body_text = getattr(body, "text", "") if body else getattr(e, "message", str(e))
                logger.warning(f"[ReadingExtractor] Groq candidate '{g_model}' failed (status={status}): {body_text}")

    # 2. Try Gemini (cascade through available Gemini endpoints)
    if not items and gemini_key:
        logger.info("[ReadingExtractor] Attempting LLM extraction via Google Gemini...")
        from openai import OpenAI
        gemini_client = OpenAI(base_url="https://generativelanguage.googleapis.com/v1beta/openai/", api_key=gemini_key)
        gemini_candidates = [
            "gemini-flash-lite-latest",
            "gemini-flash-latest",
            "gemini-3.8-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.5-flash",
        ]
        for gem_model in gemini_candidates:
            try:
                logger.info(f"[ReadingExtractor] Invoking Gemini model '{gem_model}'...")
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
                logger.info(f"[ReadingExtractor] Gemini model '{gem_model}' responded with {len(raw_out)} chars.")
                parsed = _parse_readings_json(raw_out)
                if parsed:
                    items = parsed
                    logger.info(f"[ReadingExtractor] Gemini model '{gem_model}' successfully produced {len(items)} readings.")
                    break
                else:
                    logger.info(f"[ReadingExtractor] Gemini model '{gem_model}' returned 0 parsed readings.")
            except Exception as e:
                logger.warning(f"[ReadingExtractor] Gemini candidate '{gem_model}' failed: {e}")

    # 3. Try OpenAI fallback (only if openai_key is provided or custom endpoint that is not a non-chat router)
    if not items and openai_key:
        logger.info("[ReadingExtractor] Attempting LLM extraction via OpenAI...")
        try:
            from openai import OpenAI
            client = OpenAI(
                base_url=openai_base or "https://api.openai.com/v1",
                api_key=openai_key
            )
            fallback_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
            logger.info(f"[ReadingExtractor] Invoking fallback model '{fallback_model}' at base '{openai_base or 'https://api.openai.com/v1'}'...")
            resp = client.chat.completions.create(
                model=fallback_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=3500,
                temperature=0.1
            )
            raw_out = resp.choices[0].message.content or ""
            logger.info(f"[ReadingExtractor] Fallback model '{fallback_model}' responded with {len(raw_out)} chars.")
            items = _parse_readings_json(raw_out)
            if items:
                logger.info(f"[ReadingExtractor] Fallback model '{fallback_model}' successfully produced {len(items)} readings.")
        except Exception as e:
            logger.warning(f"[ReadingExtractor] Fallback LLM failed: {e}\n{traceback.format_exc()}")

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

    logger.info(f"[ReadingExtractor] Finished LLM extraction: {len(deduped)} deduplicated reading candidates from raw {len(items)} items.")
    return deduped

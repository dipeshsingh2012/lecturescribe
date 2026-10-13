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
import logging
import traceback
import urllib.parse
import html
import concurrent.futures
import asyncio
import math
from datetime import datetime
from typing import List, Dict, Any, Optional, Set

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
    lt = title.lower()
    la = author.lower()

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

    query_parts = [f'intitle:"{title.strip()}"']
    if author and len(author.strip()) >= 3:
        clean_author = re.sub(r'(?i)\bet al\.?\b', '', author).strip()
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
                    "matched_authors": ", ".join(vol.get("authors", [])) or author,
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
        clean_title = re.sub(r'[^a-zA-Z0-9\s]', ' ', title).strip()
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
                    "matched_authors": ", ".join(vol.get("authors", [])) or author,
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

    clean_title = re.sub(r'^(?:paper|book|reading|journal)\s*:\s*', '', title, flags=re.IGNORECASE).strip()
    clean_author = re.sub(r'(?i)\bet al\.?\b', '', author).strip()

    query = f"{clean_title} {clean_author}".strip()
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
                matched_a = ", ".join(authors_list) or author
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

    clean_title = re.sub(r'^(?:paper|book|reading|journal)\s*:\s*', '', title, flags=re.IGNORECASE).strip()
    query = f'TITLE:"{clean_title}"'
    if author:
        clean_author = re.sub(r'(?i)\bet al\.?\b', '', author).strip().split()[0]
        if clean_author:
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
                matched_a = r.get("authorString") or author
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
    Extracts and normalizes canonical arXiv ID (e.g. '1706.03762v5' -> '1706.03762').
    """
    if not text:
        return None
    m = re.search(r'(?:arxiv:\s*|/abs/|/pdf/)?(\d{4}\.\d{4,5})(?:v\d+)?', str(text), flags=re.IGNORECASE)
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
    def resolve_pdf(cls, candidate_url: Optional[str], arxiv_id: Optional[str] = None) -> tuple[str, str]:
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

        if re.search(r'\b(transformer|neural network|algorithm|compiler|deep learning|arxiv|gpu)\b', q_lower):
            return "STEM_CS"

        return "GENERAL"

    @classmethod
    def get_providers_for_domain(cls, domain: str, query: str = "") -> tuple[List[str], List[str]]:
        """
        Returns (dispatched_providers, excluded_providers).
        """
        intent = _classify_query_intent(query)
        dispatched: List[str] = []
        excluded: List[str] = []

        if domain == "STEM_CS":
            # Primary: OpenAlex, Semantic Scholar, Crossref, Google Books (if monograph intent or general)
            dispatched = ["openalex", "semantic_scholar", "crossref"]
            if intent in ("monograph", "general"):
                dispatched.append("google_books")
            # HARD EXCLUSION: Europe PMC is forbidden
            excluded = ["europe_pmc"]
        elif domain == "BIOMEDICAL":
            dispatched = ["openalex", "europe_pmc", "semantic_scholar", "crossref"]
            if intent in ("monograph", "general"):
                dispatched.append("google_books")
            excluded = []
        else:
            # General / Unconstrained
            dispatched = ["openalex", "semantic_scholar", "crossref", "europe_pmc", "google_books"]
            excluded = []

        logger.info(f"[DomainRouter] Dispatching to: {dispatched} | Excluded: {excluded} (domain={domain})")
        return dispatched, excluded


class LexicalScorer:
    """
    Computes strict lexical relevance, penalizing disconnected tokens and rewarding exact phrases.
    """
    COMPOUND_PHRASES: List[str] = [
        "cross attention",
        "cross-attention",
        "self attention",
        "self-attention",
        "multi head attention",
        "multi-head attention",
        "transformer models",
        "transformer model",
        "deep neural networks"
    ]

    @classmethod
    def compute_lexical_score(cls, title: str, abstract: str, query: str) -> float:
        clean_q = (query or "").lower().strip()
        if not clean_q:
            return 0.0

        title_l = (title or "").lower().strip()
        abstract_l = (abstract or "").lower().strip()

        # Check for compound terms in query
        q_compounds = [cp for cp in cls.COMPOUND_PHRASES if cp.replace("-", " ") in clean_q or cp in clean_q]

        # Exact query match
        exact_query_match = (clean_q in title_l) or (clean_q in abstract_l)

        # Check compound match
        compound_matched = False
        if q_compounds:
            for cp in q_compounds:
                cp_alt = cp.replace("-", " ") if "-" in cp else cp.replace(" ", "-")
                if cp in title_l or cp_alt in title_l or cp in abstract_l or cp_alt in abstract_l:
                    compound_matched = True
                    break

        # Token set overlap
        q_tokens = [t for t in re.findall(r'\b[a-z0-9]{3,}\b', clean_q) if t not in ("the", "for", "and", "models", "model")]
        if not q_tokens:
            q_tokens = re.findall(r'\b[a-z0-9]{3,}\b', clean_q)

        t_tokens = set(re.findall(r'\b[a-z0-9]{3,}\b', title_l))
        a_tokens = set(re.findall(r'\b[a-z0-9]{3,}\b', abstract_l))

        overlap_title = len(set(q_tokens) & t_tokens) / len(q_tokens) if q_tokens else 0.0
        overlap_abstract = len(set(q_tokens) & a_tokens) / len(q_tokens) if (q_tokens and a_tokens) else 0.0

        score = 0.5 * overlap_title + 0.3 * overlap_abstract
        if exact_query_match:
            score += 0.2
        elif compound_matched:
            score += 0.15

        # Penalty for disconnected split tokens:
        # e.g. "cross attention" in query, but title/abstract only has "cross-domain", "cross-temporal" without "cross-attention"
        if "cross attention" in clean_q or "cross-attention" in clean_q:
            has_true_cross_attention = ("cross attention" in title_l or "cross-attention" in title_l or
                                        "cross attention" in abstract_l or "cross-attention" in abstract_l)
            if not has_true_cross_attention:
                # Disconnected tokens detected
                score *= 0.35

        return min(1.0, max(0.0, score))


def compute_hybrid_relevance(record: Dict[str, Any], query: str) -> float:
    """
    Mathematically bounded composite relevance scoring function strictly in [0.0, 1.0].
    Final Score = w_lex * S_lex + w_cit * S_cit + w_rec * S_rec + w_oa * S_oa
    where sum(w_i) == 1.0 (w_lex=0.45, w_cit=0.35, w_rec=0.15, w_oa=0.05).
    """
    w_lex = 0.45
    w_cit = 0.35
    w_rec = 0.15
    w_oa = 0.05

    title = record.get("title") or ""
    abstract = record.get("abstract") or ""

    # 1. Normalized Lexical score S_lex clamped to [0.0, 1.0] using LexicalScorer
    s_lex = LexicalScorer.compute_lexical_score(title, abstract, query)

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
    return round(min(1.0, max(0.0, final_score)), 4)


class SemanticScholarRateLimiter:
    """
    Token-bucket / Leaky-bucket rate limiter with circuit breaker for Semantic Scholar API.
    Enforces maximum 1 QPS and trips on HTTP 429 with exponential backoff.
    """
    def __init__(self, min_interval_seconds: float = 1.0):
        self.min_interval = min_interval_seconds
        self.last_request_time = 0.0
        self.circuit_open_until = 0.0
        self.backoff_duration = 30.0
        self._lock: Optional[asyncio.Lock] = None

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def acquire(self) -> bool:
        """
        Returns True if request is allowed, False if circuit is currently open.
        """
        try:
            loop = asyncio.get_running_loop()
            now = loop.time()
        except RuntimeError:
            return True

        if now < self.circuit_open_until:
            logger.debug(f"[ReadingExtractor] S2 circuit open ({self.circuit_open_until - now:.1f}s remaining). Skipping S2 call.")
            return False

        lock = self._get_lock()
        async with lock:
            now = asyncio.get_event_loop().time()
            if now < self.circuit_open_until:
                return False
            elapsed = now - self.last_request_time
            if elapsed < self.min_interval:
                await asyncio.sleep(self.min_interval - elapsed)
            self.last_request_time = asyncio.get_event_loop().time()
            return True

    def record_success(self):
        self.backoff_duration = 30.0

    def record_429(self):
        try:
            now = asyncio.get_event_loop().time()
        except RuntimeError:
            now = 0.0
        self.circuit_open_until = now + self.backoff_duration
        logger.warning(
            f"[ReadingExtractor] Semantic Scholar 429 rate limit hit. Tripping circuit breaker for {self.backoff_duration}s."
        )
        self.backoff_duration = min(300.0, self.backoff_duration * 2.0)

    def is_circuit_open(self) -> bool:
        try:
            now = asyncio.get_event_loop().time()
            return now < self.circuit_open_until
        except RuntimeError:
            return False

    def reset_circuit(self):
        self.circuit_open_until = 0.0
        self.backoff_duration = 30.0


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
    if doi_a and doi_b:
        return doi_a == doi_b

    arxiv_a = extract_canonical_arxiv_id(rec_a.get("arxiv_id") or rec_a.get("preview_url") or rec_a.get("direct_pdf_url"))
    arxiv_b = extract_canonical_arxiv_id(rec_b.get("arxiv_id") or rec_b.get("preview_url") or rec_b.get("direct_pdf_url"))
    if arxiv_a and arxiv_b:
        return arxiv_a == arxiv_b

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

        # Extract canonical arXiv ID
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
        direct_pdf, reader_type = DirectPdfResolver.resolve_pdf(candidate_pdf, arxiv_id)
        if direct_pdf:
            is_oa = True

        primary_loc = it.get("primary_location") or {}
        source_obj = primary_loc.get("source") or {}
        journal = _clean_html_text(source_obj.get("display_name") or "")
        publisher = _clean_html_text(source_obj.get("host_organization_name") or "")

        citations = it.get("cited_by_count") or 0

        preview_url = it.get("doi") or direct_pdf or raw_ids.get("openalex") or ""
        embed_url = direct_pdf if direct_pdf else ""

        type_str = (it.get("type") or "").lower()
        if "book" in type_str:
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
    try:
        resp = requests.get(
            CROSSREF_API,
            params={
                "query.bibliographic": query,
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
    try:
        resp = requests.get(
            EUROPE_PMC_API,
            params={"query": query, "format": "json", "pageSize": max(limit, 5), "resultType": "core"},
            headers={"User-Agent": "LectureScribe/1.0"},
            timeout=3.5
        )
        if resp.status_code == 200:
            return _parse_europe_pmc_items(resp.json().get("resultList", {}).get("result", []))
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Europe PMC Search] Exception: {e}")
    return []


def _fetch_google_books_candidates(query: str, limit: int) -> List[Dict[str, Any]]:
    try:
        resp = requests.get(
            GOOGLE_BOOKS_API,
            params={"q": query, "maxResults": min(max(limit, 4), 10), "printType": "books"},
            timeout=3.5
        )
        if resp.status_code == 200:
            return _parse_google_books_items(resp.json().get("items", []))
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Google Books Search] Exception: {e}")
    return []


def _fetch_openalex_candidates(query: str, limit: int) -> List[Dict[str, Any]]:
    try:
        resp = requests.get(
            OPENALEX_API,
            params={
                "search": query,
                "per-page": max(limit, 8),
                "sort": "relevance_score:desc"
            },
            headers={"User-Agent": "LectureScribe/2.1 (mailto:academic-research@lecturescribe.local)"},
            timeout=3.5
        )
        if resp.status_code == 200:
            return _parse_openalex_items(resp.json().get("results", []))
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [OpenAlex Search] Exception: {e}")
    return []


async def _fetch_crossref_candidates_async(client: httpx.AsyncClient, query: str, limit: int) -> List[Dict[str, Any]]:
    try:
        resp = await client.get(
            CROSSREF_API,
            params={
                "query.bibliographic": query,
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
    try:
        resp = await client.get(
            EUROPE_PMC_API,
            params={"query": query, "format": "json", "pageSize": max(limit, 5), "resultType": "core"},
            headers={"User-Agent": "LectureScribe/1.0"}
        )
        if resp.status_code == 200:
            return _parse_europe_pmc_items(resp.json().get("resultList", {}).get("result", []))
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Async Europe PMC Search] Exception: {e}")
    return []


async def _fetch_google_books_candidates_async(client: httpx.AsyncClient, query: str, limit: int) -> List[Dict[str, Any]]:
    try:
        resp = await client.get(
            GOOGLE_BOOKS_API,
            params={"q": query, "maxResults": min(max(limit, 4), 10), "printType": "books"}
        )
        if resp.status_code == 200:
            return _parse_google_books_items(resp.json().get("items", []))
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Async Google Books Search] Exception: {e}")
    return []


async def _fetch_openalex_candidates_async(client: httpx.AsyncClient, query: str, limit: int) -> List[Dict[str, Any]]:
    """
    Two-pass OpenAlex fetch:
      Pass 1: Relevance-sorted query for domain alignment.
      Pass 2: Citation-sorted query to guarantee seminal foundational papers are surfaced.
    Merges both passes deduplicated by work ID/DOI.
    """
    headers = {"User-Agent": "LectureScribe/2.2 (mailto:academic-research@lecturescribe.local)"}

    # Pass 1: Relevance-based candidates
    task_p1 = client.get(
        OPENALEX_API,
        params={
            "search": query,
            "per-page": max(limit, 15),
            "sort": "relevance_score:desc"
        },
        headers=headers,
        timeout=3.5
    )

    # Pass 2: Citation-authority candidates
    task_p2 = client.get(
        OPENALEX_API,
        params={
            "search": query,
            "per-page": max(limit, 10),
            "sort": "cited_by_count:desc"
        },
        headers=headers,
        timeout=3.5
    )

    try:
        resps = await asyncio.gather(task_p1, task_p2, return_exceptions=True)
        resp1, resp2 = resps[0], resps[1]

        combined_raw: List[Dict[str, Any]] = []
        seen_ids: Set[str] = set()

        if isinstance(resp1, httpx.Response) and resp1.status_code == 200:
            for item in resp1.json().get("results", []):
                work_id = str(item.get("id") or item.get("doi") or "")
                if work_id:
                    seen_ids.add(work_id)
                combined_raw.append(item)
        elif isinstance(resp1, Exception):
            logger.debug(f"[ReadingExtractor] [Async OpenAlex Pass 1] Exception: {resp1}")

        if isinstance(resp2, httpx.Response) and resp2.status_code == 200:
            for item in resp2.json().get("results", []):
                work_id = str(item.get("id") or item.get("doi") or "")
                if not work_id or work_id not in seen_ids:
                    if work_id:
                        seen_ids.add(work_id)
                    combined_raw.append(item)
        elif isinstance(resp2, Exception):
            logger.debug(f"[ReadingExtractor] [Async OpenAlex Pass 2] Exception: {resp2}")

        if combined_raw:
            return _parse_openalex_items(combined_raw)
    except Exception as e:
        logger.debug(f"[ReadingExtractor] [Async OpenAlex Two-Pass Search] Exception: {e}")

    return []


async def _fetch_semantic_scholar_candidates_async(client: httpx.AsyncClient, query: str, limit: int) -> List[Dict[str, Any]]:
    allowed = await _S2_RATE_LIMITER.acquire()
    if not allowed:
        logger.info("[SemanticScholar] [Telemetry] Request rejected by local rate limiter/circuit breaker.")
        return []
    try:
        api_key = os.getenv("SEMANTIC_SCHOLAR_API_KEY", "")
        headers = {"User-Agent": "LectureScribe/2.2"}
        if api_key:
            headers["x-api-key"] = api_key

        fields = "title,authors,year,citationCount,influentialCitationCount,abstract,openAccessPdf,externalIds,venue"
        resp = await client.get(
            SEMANTIC_SCHOLAR_API,
            params={"query": query, "limit": max(limit, 5), "fields": fields},
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
    """Enriches canonical target record with incoming metadata."""
    # 1. Citations
    target["citation_count"] = max(target.get("citation_count") or 0, incoming.get("citation_count") or 0)
    target["influential_citation_count"] = max(
        target.get("influential_citation_count") or 0, incoming.get("influential_citation_count") or 0
    )

    # 2. PMCID & PMC Reader
    if incoming.get("pmcid"):
        target["pmcid"] = incoming["pmcid"]
        if not target.get("direct_pdf_url"):
            target["embed_url"] = incoming.get("embed_url") or f"https://europepmc.org/articles/{incoming['pmcid']}"
            target["reader_type"] = "pmc_reader"

    # 3. Direct PDF & arXiv ID
    if incoming.get("arxiv_id") and not target.get("arxiv_id"):
        target["arxiv_id"] = incoming["arxiv_id"]
    if incoming.get("direct_pdf_url") and not target.get("direct_pdf_url"):
        target["direct_pdf_url"] = incoming["direct_pdf_url"]
        target["reader_type"] = "pdf_direct"
        target["embed_url"] = incoming["direct_pdf_url"]

    # 4. Open Access flag
    if incoming.get("is_open_access"):
        target["is_open_access"] = True

    # 5. Abstract - take longer non-empty
    inc_abs = incoming.get("abstract") or ""
    tar_abs = target.get("abstract") or ""
    if len(inc_abs) > len(tar_abs):
        target["abstract"] = inc_abs

    # 6. Identifiers and bibliographic fields
    for k in ("doi", "journal", "publisher", "publication_year", "preview_url", "isbn", "cover_url"):
        if not target.get(k) and incoming.get(k):
            target[k] = incoming[k]

    if not target.get("embed_url") and incoming.get("embed_url"):
        target["embed_url"] = incoming["embed_url"]
        if incoming.get("reader_type"):
            target["reader_type"] = incoming["reader_type"]


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
        r["relevance_score"] = compute_hybrid_relevance(r, query)

    return records


def _classify_query_intent(query: str) -> str:
    """Classifies user query intent into 'monograph', 'paper', or 'general'."""
    q_lower = query.lower()
    if re.search(r'\b(textbook|handbook|monograph|guide|introduction to|principles of|volume|edition)\b', q_lower):
        return "monograph"
    if re.search(r'\b(et al|jama|nejm|nature|ieee|arxiv|doi|proceedings|trial|paper|journal)\b', q_lower):
        return "paper"
    return "general"


def _adaptive_interleave(
    papers: List[Dict[str, Any]],
    books: List[Dict[str, Any]],
    limit: int,
    query: str = ""
) -> List[Dict[str, Any]]:
    """
    Dynamically balances result slots based on detected query intent.
    Guarantees monograph visibility while preventing paper citation pollution.
    """
    if limit <= 0:
        return []
    if not books:
        return papers[:limit]
    if not papers:
        return books[:limit]

    intent = _classify_query_intent(query)
    if intent == "monograph":
        target_books = min(len(books), max(1, int(limit * 0.6)))
        target_papers = limit - target_books
    elif intent == "paper":
        target_books = min(len(books), 1) if limit >= 5 else 0
        target_papers = limit - target_books
    else:
        target_books = min(len(books), 2) if limit >= 4 else (min(len(books), 1) if limit >= 2 else 0)
        target_papers = limit - target_books

    selected_books = books[:target_books]
    selected_papers = papers[:target_papers]

    rem_slots = limit - (len(selected_books) + len(selected_papers))
    if rem_slots > 0:
        if len(papers) > target_papers:
            selected_papers.extend(papers[target_papers : target_papers + rem_slots])
        elif len(books) > target_books:
            selected_books.extend(books[target_books : target_books + rem_slots])

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


def _format_and_interleave(records: List[Dict[str, Any]], limit: int, query: str = "") -> List[Dict[str, Any]]:
    books = [r for r in records if r.get("reading_type") == "book"]
    papers = [r for r in records if r.get("reading_type") != "book"]
    papers.sort(key=lambda x: x.get("relevance_score", 0.0), reverse=True)
    books.sort(key=lambda x: x.get("relevance_score", 0.0), reverse=True)
    return _adaptive_interleave(papers, books, limit=limit, query=query)


async def search_academic_literature_async(query: str, limit: int = 6, course_name: str = "") -> List[Dict[str, Any]]:
    """
    Asynchronous federated literature discovery across OpenAlex (Tier 1),
    Crossref, Europe PMC, Google Books, and Semantic Scholar (rate-limited).
    Uses DomainRouter to strictly exclude non-applicable providers (e.g. Europe PMC for STEM_CS).
    """
    if not query or len(query.strip()) < 2:
        return []

    clean_q = re.sub(r'^(?:paper|book|reading|journal)\s*:\s*', '', query.strip(), flags=re.IGNORECASE).strip()
    logger.info(f"[ReadingExtractor] Searching academic literature & books async for: '{clean_q}' (limit={limit}, course='{course_name}')")

    # Domain classification and provider routing
    domain = DomainRouter.classify_domain(course_name, clean_q)
    dispatched, excluded = DomainRouter.get_providers_for_domain(domain, clean_q)

    client = get_async_http_client()
    task_keys: List[str] = []
    tasks = []

    if "openalex" in dispatched:
        task_keys.append("openalex")
        tasks.append(asyncio.create_task(_fetch_openalex_candidates_async(client, clean_q, limit)))

    if "crossref" in dispatched:
        task_keys.append("crossref")
        tasks.append(asyncio.create_task(_fetch_crossref_candidates_async(client, clean_q, limit)))

    if "europe_pmc" in dispatched:
        task_keys.append("europe_pmc")
        tasks.append(asyncio.create_task(_fetch_europe_pmc_candidates_async(client, clean_q, limit)))

    if "google_books" in dispatched:
        task_keys.append("google_books")
        tasks.append(asyncio.create_task(_fetch_google_books_candidates_async(client, clean_q, limit)))

    if "semantic_scholar" in dispatched:
        task_keys.append("semantic_scholar")
        tasks.append(asyncio.create_task(_fetch_semantic_scholar_candidates_async(client, clean_q, limit)))

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
        query=clean_q
    )
    final_results = _format_and_interleave(consolidated, limit=limit, query=clean_q)
    logger.info(f"[ReadingExtractor] search_academic_literature_async returned {len(final_results)} results for query: '{clean_q}'")
    return final_results


def search_academic_literature(query: str, limit: int = 6, course_name: str = "") -> List[Dict[str, Any]]:
    """
    Synchronous federated literature discovery entrypoint.
    Queries OpenAlex, Crossref, Europe PMC, and Google Books concurrently.
    Uses DomainRouter to strictly exclude non-applicable providers.
    """
    if not query or len(query.strip()) < 2:
        return []

    clean_q = re.sub(r'^(?:paper|book|reading|journal)\s*:\s*', '', query.strip(), flags=re.IGNORECASE).strip()
    logger.info(f"[ReadingExtractor] Searching academic literature & books for: '{clean_q}' (limit={limit}, course='{course_name}')")

    domain = DomainRouter.classify_domain(course_name, clean_q)
    dispatched, excluded = DomainRouter.get_providers_for_domain(domain, clean_q)

    oa_items: List[Dict[str, Any]] = []
    cr_items: List[Dict[str, Any]] = []
    pmc_items: List[Dict[str, Any]] = []
    gb_items: List[Dict[str, Any]] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {}
        if "openalex" in dispatched:
            futures["openalex"] = executor.submit(_fetch_openalex_candidates, clean_q, limit)
        if "crossref" in dispatched:
            futures["crossref"] = executor.submit(_fetch_crossref_candidates, clean_q, limit)
        if "europe_pmc" in dispatched:
            futures["europe_pmc"] = executor.submit(_fetch_europe_pmc_candidates, clean_q, limit)
        if "google_books" in dispatched:
            futures["google_books"] = executor.submit(_fetch_google_books_candidates, clean_q, limit)

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
        query=clean_q
    )
    final_results = _format_and_interleave(consolidated, limit=limit, query=clean_q)
    logger.info(f"[ReadingExtractor] search_academic_literature returned {len(final_results)} results for query: '{clean_q}'")
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
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "mixtral-8x7b-32768",
        ]
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
                logger.warning(f"[ReadingExtractor] Groq candidate '{g_model}' failed: {e}")

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

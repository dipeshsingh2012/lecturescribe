"""
Zero-Cost Grounded Web Search Service for LectureScribe
-------------------------------------------------------
Uses free, keyless endpoints (DuckDuckGo & Wikipedia) to fetch supplementary
academic explanations, practical code examples, and definitions.
100% Free - No API keys or subscriptions required.
"""
import re
import requests
from typing import List, Dict, Any

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def search_web_for_context(query: str, max_results: int = 3) -> List[Dict[str, str]]:
    """
    Search DuckDuckGo and Wikipedia for external academic context.
    Returns list of dicts: [{'title': str, 'snippet': str, 'url': str}]
    """
    results: List[Dict[str, str]] = []
    clean_query = query.strip()
    if not clean_query:
        return results

    # 1. DuckDuckGo Instant Answer API (Free, JSON)
    try:
        r = requests.get(
            "https://api.duckduckgo.com/",
            params={"q": clean_query, "format": "json", "no_html": "1", "skip_disambig": "1"},
            headers=HEADERS,
            timeout=3.0
        )
        if r.status_code == 200:
            data = r.json()
            abstract = data.get("AbstractText", "").strip()
            heading = data.get("Heading", clean_query).strip()
            url = data.get("AbstractURL", "")
            if abstract:
                results.append({
                    "title": heading or "Encyclopedia Overview",
                    "snippet": abstract,
                    "url": url or f"https://duckduckgo.com/?q={clean_query}"
                })
    except Exception as e:
        pass

    # 2. DuckDuckGo HTML Lite (Free web snippets)
    if len(results) < max_results:
        try:
            r = requests.post(
                "https://html.duckduckgo.com/html/",
                data={"q": clean_query},
                headers=HEADERS,
                timeout=3.5
            )
            if r.status_code == 200:
                snippets = re.findall(r'<a class="result__snippet[^"]*"[^>]*>(.*?)</a>', r.text, re.DOTALL)
                urls = re.findall(r'<a class="result__url[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', r.text, re.DOTALL)
                titles = re.findall(r'<a class="result__title"[^>]*href="[^"]*"[^>]*>(.*?)</a>', r.text, re.DOTALL)

                for idx in range(min(len(snippets), max_results - len(results))):
                    raw_snippet = re.sub(r"<[^>]+>", "", snippets[idx]).strip()
                    raw_title = re.sub(r"<[^>]+>", "", titles[idx]).strip() if idx < len(titles) else f"Web Result {idx + 1}"
                    raw_url = urls[idx][0] if idx < len(urls) else ""
                    if raw_url.startswith("//"):
                        raw_url = "https:" + raw_url

                    if raw_snippet and len(raw_snippet) > 20:
                        results.append({
                            "title": raw_title or f"Supplementary Source {idx + 1}",
                            "snippet": raw_snippet,
                            "url": raw_url or f"https://duckduckgo.com/?q={clean_query}"
                        })
        except Exception as e:
            pass

    return results[:max_results]

import pytest
from unittest.mock import patch, MagicMock
from backend.reading_extractor import (
    search_academic_literature,
    _clean_html_text,
    _extract_year,
    _normalize_doi,
    _normalize_title,
    _interleave_results
)

REQUIRED_KEYS = [
    "title", "author", "publication_year", "reading_type", "category",
    "publisher", "journal", "doi", "pmcid", "isbn", "cover_url",
    "preview_url", "embed_url", "reader_type", "abstract",
    "source_provider", "is_open_access"
]

def test_clean_html_text():
    raw = "<h4>Background</h4><p>We test &lt;b&gt;bold&lt;/b&gt; &amp; <i>italic</i> tags.</p>"
    cleaned = _clean_html_text(raw)
    assert "<h4>" not in cleaned
    assert "<p>" not in cleaned
    assert "<i>" not in cleaned
    assert "&amp;" not in cleaned
    assert cleaned == "Background We test <b>bold</b> & italic tags."

def test_extract_year():
    assert _extract_year("2021-03-14") == "2021"
    assert _extract_year("May 1999") == "1999"
    assert _extract_year(2018) == "2018"
    assert _extract_year("No year here") == ""
    assert _extract_year(None) == ""

def test_normalize_doi():
    assert _normalize_doi("10.1001/JAMA.2016.0287") == "10.1001/jama.2016.0287"
    assert _normalize_doi("https://doi.org/10.1038/s41586-020-2649-2") == "10.1038/s41586-020-2649-2"
    assert _normalize_doi("doi:10.1145/3318464.3389700") == "10.1145/3318464.3389700"
    assert _normalize_doi("") == ""

def test_normalize_title():
    assert _normalize_title("Attention Is All You Need!") == "attentionisallyouneed"
    assert _normalize_title("  Sepsis-3 (JAMA 2016)... ") == "sepsis3jama2016"

def test_interleaving_logic():
    papers = [{"title": f"Paper {i}", "reading_type": "paper"} for i in range(5)]
    books = [{"title": f"Book {i}", "reading_type": "book"} for i in range(3)]

    # limit = 6: reserve 2 books, 4 papers
    res6 = _interleave_results(papers, books, limit=6)
    assert len(res6) == 6
    book_count6 = sum(1 for r in res6 if r["reading_type"] == "book")
    assert book_count6 == 2

    # limit = 3: at least 1 book record present when limit >= 3
    res3 = _interleave_results(papers, books, limit=3)
    assert len(res3) == 3
    book_count3 = sum(1 for r in res3 if r["reading_type"] == "book")
    assert book_count3 >= 1

    # limit = 2: at least 1 book
    res2 = _interleave_results(papers, books, limit=2)
    assert len(res2) == 2
    book_count2 = sum(1 for r in res2 if r["reading_type"] == "book")
    assert book_count2 == 1

    # only papers available
    res_no_books = _interleave_results(papers, [], limit=4)
    assert len(res_no_books) == 4
    assert all(r["reading_type"] == "paper" for r in res_no_books)

    # only books available
    res_no_papers = _interleave_results([], books, limit=2)
    assert len(res_no_papers) == 2
    assert all(r["reading_type"] == "book" for r in res_no_papers)

@patch("backend.reading_extractor.requests.get")
def test_search_academic_literature_parallel_and_merged(mock_get):
    # Setup mock responses for Crossref, Europe PMC, and Google Books
    def mock_requests_get(url, *args, **kwargs):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        
        # Verify individual request timeout is 3.5s
        assert kwargs.get("timeout") == 3.5

        if "crossref.org" in url:
            # Verify Crossref query parameters include the upstream filter & polite User-Agent
            params = kwargs.get("params", {})
            assert "type:journal-article,type:proceedings-article,type:book,type:book-chapter" in params.get("filter", "")
            headers = kwargs.get("headers", {})
            assert "LectureScribe" in headers.get("User-Agent", "")

            mock_resp.json.return_value = {
                "message": {
                    "items": [
                        {
                            "title": ["Attention Is All You Need"],
                            "author": [
                                {"given": "Ashish", "family": "Vaswani"},
                                {"given": "Noam", "family": "Shazeer"}
                            ],
                            "container-title": ["NeurIPS 2017"],
                            "publisher": "Curran Associates",
                            "DOI": "10.5555/3295222.3295349",
                            "issued": {"date-parts": [[2017, 12]]},
                            "type": "proceedings-article"
                        },
                        {
                            "title": ["Sepsis-3 Definition"],
                            "author": [{"given": "Mervyn", "family": "Singer"}],
                            # container-title is missing to test clean separation of journal vs publisher
                            "container-title": [],
                            "publisher": "American Medical Association",
                            "DOI": "10.1001/jama.2016.0287",
                            "issued": {"date-parts": [[2016]]},
                            "type": "journal-article"
                        }
                    ]
                }
            }
            return mock_resp

        elif "europepmc" in url:
            mock_resp.json.return_value = {
                "resultList": {
                    "result": [
                        {
                            # Same DOI as Sepsis-3 in Crossref -> should merge and enrich
                            "title": "The Third International Consensus Definitions for Sepsis (Sepsis-3).",
                            "authorString": "Singer M, Deutschman CS, Seymour CW",
                            "journalTitle": "JAMA",
                            "pubYear": "2016",
                            "doi": "10.1001/jama.2016.0287",
                            "pmcid": "PMC4968574",
                            "isOpenAccess": "Y",
                            "abstractText": "<h4>Context</h4><p>Sepsis definitions were last revised in 2001.</p>"
                        }
                    ]
                }
            }
            return mock_resp

        elif "googleapis.com" in url:
            mock_resp.json.return_value = {
                "items": [
                    {
                        "volumeInfo": {
                            "title": "Introduction to Algorithms",
                            "authors": ["Thomas H. Cormen", "Charles E. Leiserson"],
                            "publisher": "MIT Press",
                            "publishedDate": "2022-04-05",
                            "description": "<p>A comprehensive textbook on modern algorithms.</p>",
                            "industryIdentifiers": [{"type": "ISBN_13", "identifier": "9780262046305"}],
                            "previewLink": "https://books.google.com/books?id=algorithms123"
                        }
                    }
                ]
            }
            return mock_resp

        mock_resp.status_code = 404
        return mock_resp

    mock_get.side_effect = mock_requests_get

    results = search_academic_literature("attention models algorithms", limit=4)

    # 1. Output contract check: Every dictionary conforms to target schema
    assert len(results) > 0
    for r in results:
        for k in REQUIRED_KEYS:
            assert k in r, f"Missing key '{k}' in result"
        assert isinstance(r["title"], str)
        assert isinstance(r["author"], str)
        assert isinstance(r["publication_year"], str)
        assert isinstance(r["is_open_access"], bool)
        # Check no HTML tags in abstract
        assert "<" not in r["abstract"]
        assert ">" not in r["abstract"]

    # 2. Check deduplication & enrichment of Sepsis-3 between Crossref and Europe PMC
    sepsis_matches = [r for r in results if r["doi"] == "10.1001/jama.2016.0287"]
    assert len(sepsis_matches) == 1, "Crossref and Europe PMC duplicate was not merged!"
    merged_sepsis = sepsis_matches[0]
    assert merged_sepsis["pmcid"] == "PMC4968574"
    assert merged_sepsis["embed_url"] == "https://europepmc.org/articles/PMC4968574"
    assert merged_sepsis["reader_type"] == "pmc_reader"
    assert merged_sepsis["is_open_access"] is True
    assert "Context Sepsis definitions were last revised in 2001." in merged_sepsis["abstract"]
    assert merged_sepsis["journal"] == "JAMA"
    assert merged_sepsis["publisher"] == "American Medical Association"

    # 3. Clean separation of journal and publisher on record without container-title
    attention_paper = next(r for r in results if "Attention" in r["title"])
    assert attention_paper["journal"] == "NeurIPS 2017"
    assert attention_paper["publisher"] == "Curran Associates"
    assert attention_paper["author"] == "Ashish Vaswani, Noam Shazeer"
    assert attention_paper["publication_year"] == "2017"

    # 4. Check book interleaving
    book_results = [r for r in results if r["reading_type"] == "book"]
    assert len(book_results) >= 1, "Book should be present in results for limit=4"
    book = book_results[0]
    assert book["title"] == "Introduction to Algorithms"
    assert book["author"] == "Thomas H. Cormen, Charles E. Leiserson"
    assert book["publication_year"] == "2022"
    assert book["isbn"] == "9780262046305"
    assert book["reader_type"] == "google_embed"
    assert book["abstract"] == "A comprehensive textbook on modern algorithms."

@patch("backend.reading_extractor.requests.get")
def test_search_academic_literature_graceful_failure(mock_get):
    # Test that failure/timeout of one provider does not fail the entire query
    def mock_flaky_get(url, *args, **kwargs):
        if "crossref.org" in url:
            raise Exception("Crossref connection timeout")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        if "europepmc" in url:
            mock_resp.json.return_value = {
                "resultList": {
                    "result": [
                        {
                            "title": "A PMC Paper",
                            "authorString": "Jane Doe",
                            "pubYear": "2020",
                            "doi": "10.1234/pmc.1"
                        }
                    ]
                }
            }
            return mock_resp
        elif "googleapis.com" in url:
            mock_resp.json.return_value = {
                "items": [
                    {
                        "volumeInfo": {
                            "title": "A Great Book",
                            "authors": ["John Smith"],
                            "publishedDate": "2019"
                        }
                    }
                ]
            }
            return mock_resp
        return mock_resp

    mock_get.side_effect = mock_flaky_get
    results = search_academic_literature("resilience query", limit=3)
    assert len(results) == 2
    titles = [r["title"] for r in results]
    assert "A PMC Paper" in titles
    assert "A Great Book" in titles

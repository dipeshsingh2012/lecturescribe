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


def test_are_records_equivalent_generic_title_guard():
    from backend.reading_extractor import _are_records_equivalent
    # Two generic papers titled "Introduction" by different authors -> should NOT merge
    paper_a = {"title": "Introduction", "author": "John Doe", "publication_year": "2020", "doi": ""}
    paper_b = {"title": "Introduction", "author": "Alice Smith", "publication_year": "2020", "doi": ""}
    assert not _are_records_equivalent(paper_a, paper_b)

    # Same generic title by same author surname -> should merge
    paper_c = {"title": "Introduction", "author": "J. Doe", "publication_year": "2020", "doi": ""}
    assert _are_records_equivalent(paper_a, paper_c)


def test_are_records_equivalent_subtitle_jaccard():
    from backend.reading_extractor import _are_records_equivalent
    # Crossref vs Europe PMC subtitle variation
    item_crossref = {
        "title": "Attention Is All You Need",
        "author": "Ashish Vaswani, Noam Shazeer",
        "publication_year": "2017",
        "doi": ""
    }
    item_pmc = {
        "title": "Attention Is All You Need: A Deep Learning Architecture",
        "author": "Vaswani A, Shazeer N",
        "publication_year": "2017",
        "doi": ""
    }
    assert _are_records_equivalent(item_crossref, item_pmc)


def test_intent_adaptive_interleaving():
    from backend.reading_extractor import _adaptive_interleave, _classify_query_intent
    papers = [{"title": f"Paper {i}", "reading_type": "paper"} for i in range(5)]
    books = [{"title": f"Book {i}", "reading_type": "book"} for i in range(5)]

    # Monograph query -> textbook slots prioritized
    assert _classify_query_intent("Cormen Introduction to Algorithms textbook 4th edition") == "monograph"
    res_mono = _adaptive_interleave(papers, books, limit=6, query="Cormen Introduction to Algorithms textbook 4th edition")
    book_count = sum(1 for r in res_mono if r["reading_type"] == "book")
    assert book_count >= 3

    # Citation query -> paper slots prioritized
    assert _classify_query_intent("Singer et al. Sepsis-3 JAMA 2016") == "paper"
    res_paper = _adaptive_interleave(papers, books, limit=6, query="Singer et al. Sepsis-3 JAMA 2016")
    book_count_paper = sum(1 for r in res_paper if r["reading_type"] == "book")
    assert book_count_paper <= 1


@pytest.mark.anyio
async def test_search_academic_literature_async():
    from backend.reading_extractor import search_academic_literature_async
    with patch("backend.reading_extractor._fetch_crossref_candidates_async") as mock_cr, \
         patch("backend.reading_extractor._fetch_europe_pmc_candidates_async") as mock_pmc, \
         patch("backend.reading_extractor._fetch_google_books_candidates_async") as mock_gb:
        
        mock_cr.return_value = [
            {"title": "Async Attention Paper", "author": "Vaswani", "publication_year": "2017", "reading_type": "paper", "category": "reference", "publisher": "", "journal": "", "doi": "10.123/async.1", "pmcid": "", "isbn": "", "cover_url": "", "preview_url": "", "embed_url": "", "reader_type": "web", "abstract": "Test", "source_provider": "Crossref", "is_open_access": False}
        ]
        mock_pmc.return_value = []
        mock_gb.return_value = [
            {"title": "Async Deep Learning Book", "author": "Goodfellow", "publication_year": "2016", "reading_type": "book", "category": "primary_textbook", "publisher": "MIT Press", "journal": "", "doi": "", "pmcid": "", "isbn": "123", "cover_url": "", "preview_url": "", "embed_url": "", "reader_type": "web", "abstract": "Book", "source_provider": "Google Books", "is_open_access": False}
        ]

        res = await search_academic_literature_async("deep learning", limit=4)
        assert len(res) == 2
        titles = [r["title"] for r in res]
        assert "Async Attention Paper" in titles
        assert "Async Deep Learning Book" in titles


def test_empty_and_boundary_queries():
    # Sync entrypoint boundary checks
    assert search_academic_literature("") == []
    assert search_academic_literature("   ") == []
    assert search_academic_literature("x") == []

    # Query prefix stripping (paper:, book:, reading:, journal:)
    with patch("backend.reading_extractor._fetch_crossref_candidates") as mock_cr, \
         patch("backend.reading_extractor._fetch_europe_pmc_candidates") as mock_pmc, \
         patch("backend.reading_extractor._fetch_google_books_candidates") as mock_gb:
        mock_cr.return_value = []
        mock_pmc.return_value = []
        mock_gb.return_value = []

        search_academic_literature("paper: Deep Residual Learning")
        mock_cr.assert_called_once_with("Deep Residual Learning", 6)

        mock_gb.reset_mock()
        search_academic_literature("book: Operating Systems", limit=3)
        mock_gb.assert_called_once_with("Operating Systems", 3)


@pytest.mark.anyio
async def test_empty_and_boundary_queries_async():
    from backend.reading_extractor import search_academic_literature_async
    # Async entrypoint boundary checks
    assert await search_academic_literature_async("") == []
    assert await search_academic_literature_async("   ") == []
    assert await search_academic_literature_async("q") == []


def test_extract_author_surnames_and_formats():
    from backend.reading_extractor import _extract_author_surnames
    # Western order (First Last)
    surnames_western = _extract_author_surnames("Ashish Vaswani, Noam Shazeer")
    assert "vaswani" in surnames_western
    assert "shazeer" in surnames_western

    # PubMed indexed format (Last FirstInitial)
    surnames_pubmed = _extract_author_surnames("Vaswani A, Shazeer N")
    assert "vaswani" in surnames_pubmed
    assert "shazeer" in surnames_pubmed

    # Multiple authors with middle initials
    surnames_med = _extract_author_surnames("Singer M, Deutschman CS, Seymour CW")
    assert "singer" in surnames_med
    assert "deutschman" in surnames_med
    assert "seymour" in surnames_med

    # Single author
    assert "cormen" in _extract_author_surnames("Thomas H. Cormen")
    assert "cormen" in _extract_author_surnames("Cormen")

    # Empty / none
    assert _extract_author_surnames("") == set()
    assert _extract_author_surnames(None) == set()


def test_primary_title_extraction_and_jaccard():
    from backend.reading_extractor import _extract_primary_title, _token_jaccard_similarity
    # Subtitle colon/dash splitting (returns lowercased normalized base title)
    assert _extract_primary_title("Deep Learning: An MIT Press Book") == "deep learning"
    assert _extract_primary_title("Artificial Intelligence - A Modern Approach") == "artificial intelligence"
    assert _extract_primary_title("Attention Is All You Need: A Neural Framework") == "attention is all you need"
    assert _extract_primary_title("Clean Code") == "clean code"

    # Token Jaccard similarity
    sim_high = _token_jaccard_similarity("Machine Learning for Healthcare", "Machine Learning in Healthcare")
    assert sim_high >= 0.75

    sim_diff = _token_jaccard_similarity("Quantum Computing Algorithms", "Classical Electrodynamics")
    assert sim_diff < 0.2


def test_year_tolerance_in_record_equivalence():
    from backend.reading_extractor import _are_records_equivalent
    # Preprint (2017) vs Journal release (2018): 1-year tolerance should match
    paper_preprint = {
        "title": "Attention Is All You Need",
        "author": "Vaswani Ashish",
        "publication_year": "2017",
        "doi": ""
    }
    paper_journal = {
        "title": "Attention Is All You Need",
        "author": "Vaswani A",
        "publication_year": "2018",
        "doi": ""
    }
    assert _are_records_equivalent(paper_preprint, paper_journal) is True

    # Multi-year gap (>1 year) indicating different editions or distinct works
    edition_1 = {
        "title": "Introduction to Algorithms",
        "author": "Cormen",
        "publication_year": "2009",
        "doi": ""
    }
    edition_4 = {
        "title": "Introduction to Algorithms",
        "author": "Cormen",
        "publication_year": "2022",
        "doi": ""
    }
    assert _are_records_equivalent(edition_1, edition_4) is False


def test_consolidate_and_merge_metadata_enrichment():
    from backend.reading_extractor import _consolidate_and_merge_records
    cr_item = {
        "title": "Consensus Definitions for Sepsis",
        "author": "Singer M",
        "publication_year": "2016",
        "reading_type": "paper",
        "category": "reference",
        "publisher": "AMA",
        "journal": "JAMA",
        "doi": "10.1001/jama.2016.0287",
        "pmcid": "",
        "isbn": "",
        "cover_url": "",
        "preview_url": "https://doi.org/10.1001/jama.2016.0287",
        "embed_url": "",
        "reader_type": "web",
        "abstract": "Short abstract",
        "source_provider": "Crossref",
        "is_open_access": False
    }

    pmc_item = {
        "title": "The Third International Consensus Definitions for Sepsis (Sepsis-3)",
        "author": "Singer M, Deutschman CS",
        "publication_year": "2016",
        "reading_type": "paper",
        "category": "reference",
        "publisher": "",
        "journal": "",
        "doi": "10.1001/jama.2016.0287",
        "pmcid": "PMC4968574",
        "isbn": "",
        "cover_url": "",
        "preview_url": "https://europepmc.org/article/MED/26903338",
        "embed_url": "https://europepmc.org/articles/PMC4968574",
        "reader_type": "pmc_reader",
        "abstract": "A comprehensive multi-sentence abstract explaining sepsis-3 clinical criteria and organ failure scoring in intensive care units.",
        "source_provider": "Europe PMC",
        "is_open_access": True
    }

    merged = _consolidate_and_merge_records([cr_item], [pmc_item], [])
    assert len(merged) == 1
    record = merged[0]

    # Retains Crossref citation data
    assert record["journal"] == "JAMA"
    assert record["publisher"] == "AMA"
    assert record["doi"] == "10.1001/jama.2016.0287"

    # Enriched with Europe PMC metadata
    assert record["pmcid"] == "PMC4968574"
    assert record["reader_type"] == "pmc_reader"
    assert record["embed_url"] == "https://europepmc.org/articles/PMC4968574"
    assert record["is_open_access"] is True
    assert "comprehensive multi-sentence abstract" in record["abstract"]


@pytest.mark.anyio
async def test_search_academic_literature_async_provider_errors():
    import httpx
    from backend.reading_extractor import search_academic_literature_async

    with patch("backend.reading_extractor._fetch_crossref_candidates_async") as mock_cr, \
         patch("backend.reading_extractor._fetch_europe_pmc_candidates_async") as mock_pmc, \
         patch("backend.reading_extractor._fetch_google_books_candidates_async") as mock_gb:

        # Crossref raises Timeout, Europe PMC raises HTTP Error
        mock_cr.side_effect = httpx.ConnectTimeout("Crossref gateway timeout")
        mock_pmc.side_effect = httpx.HTTPStatusError("500 Internal Server Error", request=MagicMock(), response=MagicMock())
        # Google Books succeeds
        mock_gb.return_value = [
            {
                "title": "Artificial Intelligence: A Modern Approach",
                "author": "Stuart Russell, Peter Norvig",
                "publication_year": "2020",
                "reading_type": "book",
                "category": "primary_textbook",
                "publisher": "Pearson",
                "journal": "",
                "doi": "",
                "pmcid": "",
                "isbn": "9780134610993",
                "cover_url": "https://books.google.com/cover.jpg",
                "preview_url": "https://books.google.com/preview",
                "embed_url": "https://books.google.com/embed",
                "reader_type": "google_embed",
                "abstract": "The leading textbook in Artificial Intelligence.",
                "source_provider": "Google Books",
                "is_open_access": False
            }
        ]

        # Pipeline should isolate exceptions and return Google Books results without failing
        results = await search_academic_literature_async("artificial intelligence", limit=4)
        assert len(results) == 1
        book = results[0]
        assert book["title"] == "Artificial Intelligence: A Modern Approach"
        assert book["source_provider"] == "Google Books"
        for k in REQUIRED_KEYS:
            assert k in book


def test_fastapi_search_endpoint_e2e():
    from fastapi.testclient import TestClient
    from backend.main import app

    client = TestClient(app)

    # 1. Successful academic search through FastAPI endpoint
    with patch("backend.main.search_academic_literature_async") as mock_search:
        mock_search.return_value = [
            {
                "title": "Attention Is All You Need",
                "author": "Vaswani et al.",
                "publication_year": "2017",
                "reading_type": "paper",
                "category": "reference",
                "publisher": "NeurIPS",
                "journal": "NeurIPS 2017",
                "doi": "10.5555/3295222.3295349",
                "pmcid": "",
                "isbn": "",
                "cover_url": "",
                "preview_url": "https://arxiv.org/abs/1706.03762",
                "embed_url": "",
                "reader_type": "web",
                "abstract": "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
                "source_provider": "Crossref",
                "is_open_access": True
            }
        ]

        res = client.post(
            "/api/course/CS224N/search-literature",
            json={"query": "transformers attention", "limit": 3}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"
        assert data["query"] == "transformers attention"
        assert data["count"] == 1
        assert len(data["results"]) == 1
        result_item = data["results"][0]
        assert result_item["title"] == "Attention Is All You Need"
        for k in REQUIRED_KEYS:
            assert k in result_item

    # 2. Validation error: empty query
    res_empty_query = client.post(
        "/api/course/CS224N/search-literature",
        json={"query": "   ", "limit": 4}
    )
    assert res_empty_query.status_code == 400
    assert "Search query is required." in res_empty_query.json()["detail"]

    # 3. Validation error: whitespace course name
    res_blank_course = client.post(
        "/api/course/%20%20/search-literature",
        json={"query": "algorithms", "limit": 4}
    )
    assert res_blank_course.status_code == 400
    assert "course_name is required." in res_blank_course.json()["detail"]


def test_reconstruct_inverted_abstract():
    from backend.reading_extractor import reconstruct_inverted_abstract

    # 1. Standard structured dictionary
    idx_standard = {"Attention": [0], "is": [1], "all": [2], "you": [3], "need": [4]}
    assert reconstruct_inverted_abstract(idx_standard) == "Attention is all you need"

    # 2. Out of order index dictionary
    idx_scrambled = {"need": [4], "Attention": [0], "all": [2], "is": [1], "you": [3]}
    assert reconstruct_inverted_abstract(idx_scrambled) == "Attention is all you need"

    # 3. Repeated tokens
    idx_repeated = {"the": [0, 3], "transformer": [1], "architecture": [2], "model": [4]}
    assert reconstruct_inverted_abstract(idx_repeated) == "the transformer architecture the model"

    # 4. Gaps / missing indices (clean spacing without crashes)
    idx_gaps = {"start": [0], "end": [3]}
    assert reconstruct_inverted_abstract(idx_gaps) == "start end"

    # 5. Nil and malformed inputs
    assert reconstruct_inverted_abstract(None) is None
    assert reconstruct_inverted_abstract({}) is None
    assert reconstruct_inverted_abstract({"bad": "not a list"}) is None
    assert reconstruct_inverted_abstract([]) is None


def test_extract_canonical_arxiv_id():
    from backend.reading_extractor import extract_canonical_arxiv_id

    # Strips versions and normalizes
    assert extract_canonical_arxiv_id("1706.03762v5") == "1706.03762"
    assert extract_canonical_arxiv_id("arxiv:1706.03762") == "1706.03762"
    assert extract_canonical_arxiv_id("https://arxiv.org/abs/2103.00020v1") == "2103.00020"
    assert extract_canonical_arxiv_id("https://arxiv.org/pdf/2103.00020.pdf") == "2103.00020"
    assert extract_canonical_arxiv_id("doi:10.48550/arXiv.1706.03762") == "1706.03762"

    # Unmatched / null
    assert extract_canonical_arxiv_id("") is None
    assert extract_canonical_arxiv_id(None) is None
    assert extract_canonical_arxiv_id("random text without id") is None


def test_hybrid_scoring_mathematical_boundaries():
    from datetime import datetime
    from backend.reading_extractor import compute_hybrid_relevance

    curr_year = str(datetime.now().year)

    # 1. Maximum possible inputs: score must NOT breach 1.0
    record_max = {
        "title": "Cross Attention Transformer Models",
        "abstract": "We explore cross attention transformer models in deep neural networks.",
        "citation_count": 10_000_000,
        "publication_year": curr_year,
        "direct_pdf_url": "https://arxiv.org/pdf/1706.03762.pdf",
        "is_open_access": True
    }
    score_max = compute_hybrid_relevance(record_max, "cross attention transformer models")
    assert 0.0 <= score_max <= 1.0, f"Score {score_max} breached [0.0, 1.0] boundary!"
    assert score_max >= 0.95

    # 2. Minimal / Zero inputs: score must not be negative and should observe recency floor
    record_min = {
        "title": "Irrelevant Antique Document",
        "abstract": "Unrelated historical text.",
        "citation_count": 0,
        "publication_year": "1960",
        "direct_pdf_url": "",
        "is_open_access": False
    }
    score_min = compute_hybrid_relevance(record_min, "cross attention transformer models")
    assert 0.0 <= score_min <= 1.0
    # Minimum score reflects recency floor weight (0.15 * 0.25 = ~0.0375)
    assert score_min > 0.0 and score_min <= 0.15

    # 3. Empty strings and None fields should not crash and stay bounded
    record_sparse = {
        "title": "",
        "abstract": None,
        "citation_count": -5,
        "publication_year": "invalid-year",
        "direct_pdf_url": None,
        "is_open_access": False
    }
    score_sparse = compute_hybrid_relevance(record_sparse, "test query")
    assert 0.0 <= score_sparse <= 1.0


@pytest.mark.anyio
async def test_semantic_scholar_rate_limiter_and_circuit():
    from backend.reading_extractor import SemanticScholarRateLimiter

    limiter = SemanticScholarRateLimiter(min_interval_seconds=0.01)
    # Circuit starts closed
    assert not limiter.is_circuit_open()
    assert await limiter.acquire() is True

    # 429 trips the circuit
    limiter.record_429()
    assert limiter.is_circuit_open() is True
    # Subsequent acquire is rejected immediately
    assert await limiter.acquire() is False

    # Reset circuit restores availability
    limiter.reset_circuit()
    assert not limiter.is_circuit_open()
    assert await limiter.acquire() is True


@pytest.mark.anyio
async def test_openalex_tier1_primary_and_s2_fallback():
    from backend.reading_extractor import (
        search_academic_literature_async,
        _S2_RATE_LIMITER
    )

    with patch("backend.reading_extractor._fetch_openalex_candidates_async") as mock_oa, \
         patch("backend.reading_extractor._fetch_semantic_scholar_candidates_async") as mock_s2, \
         patch("backend.reading_extractor._fetch_crossref_candidates_async") as mock_cr, \
         patch("backend.reading_extractor._fetch_europe_pmc_candidates_async") as mock_pmc, \
         patch("backend.reading_extractor._fetch_google_books_candidates_async") as mock_gb:

        # OpenAlex returns canonical attention paper with arXiv ID and inverted abstract
        mock_oa.return_value = [
            {
                "title": "Attention Is All You Need",
                "author": "Ashish Vaswani, Noam Shazeer",
                "publication_year": "2017",
                "reading_type": "paper",
                "category": "reference",
                "publisher": "NeurIPS",
                "journal": "NeurIPS 2017",
                "doi": "10.5555/3295222.3295349",
                "arxiv_id": "1706.03762",
                "pmcid": "",
                "isbn": "",
                "cover_url": "",
                "preview_url": "https://arxiv.org/abs/1706.03762",
                "direct_pdf_url": "https://arxiv.org/pdf/1706.03762.pdf",
                "embed_url": "https://arxiv.org/pdf/1706.03762.pdf",
                "reader_type": "pdf_direct",
                "abstract": "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
                "citation_count": 130000,
                "influential_citation_count": 0,
                "source_provider": "OpenAlex",
                "is_open_access": True,
                "relevance_score": 0.0
            }
        ]

        # S2 is simulated as rate-limited (empty return)
        mock_s2.return_value = []
        mock_cr.return_value = []
        mock_pmc.return_value = []
        mock_gb.return_value = []

        results = await search_academic_literature_async("attention transformer", limit=2)
        assert len(results) == 1
        item = results[0]
        assert item["title"] == "Attention Is All You Need"
        assert item["arxiv_id"] == "1706.03762"
        assert item["direct_pdf_url"] == "https://arxiv.org/pdf/1706.03762.pdf"
        assert item["citation_count"] == 130000
        assert 0.0 <= item["relevance_score"] <= 1.0
        assert item["reader_type"] == "pdf_direct"


@pytest.mark.anyio
async def test_domain_router_excludes_europe_pmc_for_mtech():
    from backend.reading_extractor import (
        DomainRouter,
        search_academic_literature_async
    )

    domain = DomainRouter.classify_domain("master-of-technology", "cross attention transformer models")
    assert domain == "STEM_CS"

    dispatched, excluded = DomainRouter.get_providers_for_domain(domain, "cross attention transformer models")
    assert "europe_pmc" not in dispatched
    assert "europe_pmc" in excluded
    assert "openalex" in dispatched
    assert "semantic_scholar" in dispatched

    # In search_academic_literature_async with course_name="master-of-technology", europe_pmc candidate fetcher should NEVER be invoked
    with patch("backend.reading_extractor._fetch_openalex_candidates_async") as mock_oa, \
         patch("backend.reading_extractor._fetch_semantic_scholar_candidates_async") as mock_s2, \
         patch("backend.reading_extractor._fetch_crossref_candidates_async") as mock_cr, \
         patch("backend.reading_extractor._fetch_europe_pmc_candidates_async") as mock_pmc, \
         patch("backend.reading_extractor._fetch_google_books_candidates_async") as mock_gb:

        mock_oa.return_value = []
        mock_s2.return_value = []
        mock_cr.return_value = []
        mock_pmc.return_value = []
        mock_gb.return_value = []

        await search_academic_literature_async("cross attention transformer models", limit=5, course_name="master-of-technology")
        mock_pmc.assert_not_called()


@pytest.mark.anyio
async def test_two_pass_fetch_surfaces_foundational_papers():
    import httpx
    from backend.reading_extractor import _fetch_openalex_candidates_async

    # Mock client.get to inspect two passes
    async def mock_get(url, params=None, headers=None, timeout=None):
        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 200

        sort = params.get("sort")
        if sort == "relevance_score:desc":
            # Pass 1: Returns a recent preprint
            mock_resp.json.return_value = {
                "results": [
                    {
                        "id": "https://openalex.org/W100",
                        "title": "Cross-Attention Mechanisms in 2026",
                        "authorships": [{"author": {"display_name": "Alice Smith"}}],
                        "publication_year": 2026,
                        "type": "article",
                        "cited_by_count": 2,
                        "open_access": {"is_oa": True, "oa_url": "https://arxiv.org/pdf/2601.12345.pdf"}
                    }
                ]
            }
        elif sort == "cited_by_count:desc":
            # Pass 2: Returns the foundational Vaswani paper
            mock_resp.json.return_value = {
                "results": [
                    {
                        "id": "https://openalex.org/W200",
                        "title": "Attention Is All You Need",
                        "authorships": [{"author": {"display_name": "Ashish Vaswani"}}],
                        "publication_year": 2017,
                        "type": "article",
                        "cited_by_count": 135000,
                        "ids": {"arxiv": "https://arxiv.org/abs/1706.03762"},
                        "open_access": {"is_oa": True, "oa_url": "https://arxiv.org/pdf/1706.03762.pdf"}
                    }
                ]
            }
        return mock_resp

    client = MagicMock(spec=httpx.AsyncClient)
    client.get = mock_get

    items = await _fetch_openalex_candidates_async(client, "cross attention transformer models", limit=5)
    titles = [it["title"] for it in items]
    assert "Attention Is All You Need" in titles
    assert "Cross-Attention Mechanisms in 2026" in titles
    foundational = next(it for it in items if it["title"] == "Attention Is All You Need")
    assert foundational["citation_count"] == 135000


def test_lexical_scorer_penalizes_disconnected_cross_tokens():
    from backend.reading_extractor import LexicalScorer

    query = "cross attention transformer models"

    # Paper A: Legitimate compound cross-attention model
    title_a = "Cross-Attention in Transformer Models for Vision"
    abstract_a = "We utilize cross attention mechanism in deep neural networks."
    score_a = LexicalScorer.compute_lexical_score(title_a, abstract_a, query)

    # Paper B: Disconnected tokens: cross-domain, cross-temporal, attention
    title_b = "Cross-Domain and Cross-Temporal Analysis with Attention Models"
    abstract_b = "We evaluate temporal models across domains using self-attention."
    score_b = LexicalScorer.compute_lexical_score(title_b, abstract_b, query)

    assert score_a > score_b
    # Disconnected token penalty should significantly suppress Paper B
    assert score_b < 0.4


def test_direct_pdf_url_rejects_doi_landing_page():
    from backend.reading_extractor import DirectPdfResolver

    # False landing pages that should be rejected
    doi_landing_url = "https://doi.org/10.1088/1742-6596/1234/1/012001"
    iop_landing_url = "https://iopscience.iop.org/article/10.1088/1742-6596/1234/1/012001"
    sciencedirect_url = "https://www.sciencedirect.com/science/article/pii/S002200002100012X"

    assert DirectPdfResolver.is_authentic_pdf_url(doi_landing_url) is False
    assert DirectPdfResolver.is_authentic_pdf_url(iop_landing_url) is False
    assert DirectPdfResolver.is_authentic_pdf_url(sciencedirect_url) is False

    pdf_url, reader_type = DirectPdfResolver.resolve_pdf(doi_landing_url, arxiv_id=None)
    assert pdf_url == ""
    assert reader_type == "web"

    # True binary PDF URLs
    arxiv_pdf_url = "https://arxiv.org/pdf/1706.03762.pdf"
    clean_pdf_url = "https://www.nature.com/articles/s41586-020-2649-2.pdf"
    assert DirectPdfResolver.is_authentic_pdf_url(arxiv_pdf_url) is True
    assert DirectPdfResolver.is_authentic_pdf_url(clean_pdf_url) is True

    resolved_arxiv, arxiv_reader = DirectPdfResolver.resolve_pdf(arxiv_pdf_url)
    assert resolved_arxiv == arxiv_pdf_url
    assert arxiv_reader == "pdf_direct"

    # Fallback when candidate url is landing page but arxiv_id is present
    fallback_pdf, fallback_reader = DirectPdfResolver.resolve_pdf(doi_landing_url, arxiv_id="1706.03762")
    assert fallback_pdf == "https://arxiv.org/pdf/1706.03762.pdf"
    assert fallback_reader == "pdf_direct"


def test_lexical_scorer_rejects_subtoken_collision_swin_transformer():
    """
    Validates that papers mentioning 'cross-window' or 'cross-domain' (e.g. Swin Transformer)
    do not falsely match 'cross' in a 'cross-attention' query.
    """
    from backend.reading_extractor import LexicalScorer

    query = "cross attention transformer models"

    # Paper A: Swin Transformer with 'cross-window' attention
    swin_title = "Swin Transformer: Hierarchical Vision Transformer using Shifted Windows"
    swin_abstract = "We propose shifted windowing scheme which brings greater efficiency by limiting self-attention computation to non-overlapping local windows while also allowing for cross-window connection."
    swin_score = LexicalScorer.compute_lexical_score(swin_title, swin_abstract, query)

    # Paper B: Authentic Cross-Attention Transformer
    ca_title = "Cross-Attention Transformer for Semantic Segmentation"
    ca_abstract = "We design a cross-attention module that exchanges feature representations across dual transformer models."
    ca_score = LexicalScorer.compute_lexical_score(ca_title, ca_abstract, query)

    # Swin score must be heavily penalized because 'cross-window' is NOT 'cross-attention'
    assert swin_score < 0.20
    assert ca_score > 0.60
    assert ca_score > 3.0 * swin_score


def test_lexical_scorer_canonical_synonym_encoder_decoder_attention():
    """
    Validates that foundational paper using 'encoder-decoder attention' (Vaswani et al., 2017)
    receives high lexical relevance for a 'cross attention transformer models' query.
    """
    from backend.reading_extractor import LexicalScorer

    query = "cross attention transformer models"

    # Vaswani et al. 2017: Attention Is All You Need
    title = "Attention Is All You Need"
    abstract = "In 'encoder-decoder attention' layers, the queries come from the previous decoder layer, and the memory keys and values come from the output of the encoder. We propose the Transformer, a model architecture relying entirely on an attention mechanism."

    score = LexicalScorer.compute_lexical_score(title, abstract, query)
    assert score >= 0.50


def test_arxiv_id_auto_populated_from_resolved_urls():
    """
    Validates that arxiv_id is automatically extracted when direct_pdf_url or preview_url points to arXiv.
    """
    from backend.reading_extractor import _consolidate_and_merge_records

    # Candidate with missing arxiv_id but valid arXiv direct_pdf_url
    candidate_records = [
        {
            "title": "Swin Transformer",
            "author": "Ze Liu",
            "publication_year": "2021",
            "reading_type": "paper",
            "category": "reference",
            "publisher": "",
            "journal": "ICCV",
            "doi": "",
            "arxiv_id": "",  # Empty initially
            "direct_pdf_url": "https://arxiv.org/pdf/2103.14030.pdf",
            "preview_url": "https://arxiv.org/abs/2103.14030",
            "reader_type": "pdf_direct",
            "abstract": "Hierarchical vision transformer.",
            "citation_count": 15000,
            "influential_citation_count": 1200,
            "source_provider": "OpenAlex",
            "is_open_access": True
        }
    ]

    merged = _consolidate_and_merge_records(openalex_items=candidate_records, query="vision transformer")
    assert len(merged) == 1
    assert merged[0]["arxiv_id"] == "2103.14030"


def test_lexical_scorer_generalized_arbitrary_query():
    """
    Validates that LexicalScorer dynamically extracts n-grams and enforces
    atomic compound proximity on completely arbitrary domains without hardcoded rules.
    """
    from backend.reading_extractor import LexicalScorer

    # Arbitrary domain: biology / immunology
    bio_query = "chimeric antigen receptor"
    phrases = LexicalScorer.get_query_phrases(bio_query)
    assert "chimeric antigen" in phrases
    assert "antigen receptor" in phrases
    assert "chimeric antigen receptor" in phrases

    # Paper A: Legitimate CAR T-cell paper with atomic phrase
    title_a = "Chimeric Antigen Receptor T-cell Therapy for Leukemia"
    abs_a = "We design chimeric antigen receptor constructs targeting CD19."
    score_a = LexicalScorer.compute_lexical_score(title_a, abs_a, bio_query)

    # Paper B: Scattered / sub-token collision (e.g. "chimeric-mouse ... antigen ... receptor-like")
    title_b = "Chimeric-mouse Models for Antigen Presentation"
    abs_b = "We evaluate receptor-like proteins in transgenic mice."
    score_b = LexicalScorer.compute_lexical_score(title_b, abs_b, bio_query)

    assert score_a > 0.60
    assert score_b < 0.25
    assert score_a > 2.5 * score_b





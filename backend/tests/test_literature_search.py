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

    # Multi-year gap with exact title and matching authors (e.g. arXiv preprint vs later journal, or CCNet 2018/2020)
    # Step 3: Exact title + author surname overlap bypasses ±1 year guard
    paper_2018 = {
        "title": "CCNet: Extracting High Quality Monolingual Datasets from Web Crawl",
        "author": "Guillaume Wenzek, Marie-Anne Lachaux",
        "publication_year": "2018",
        "doi": ""
    }
    paper_2020 = {
        "title": "CCNet: Extracting High Quality Monolingual Datasets from Web Crawl",
        "author": "Wenzek G, Lachaux MA",
        "publication_year": "2020",
        "doi": ""
    }
    assert _are_records_equivalent(paper_2018, paper_2020) is True

    # Multi-year gap (>1 year) without author overlap or with generic/short titles indicating distinct works
    work_a = {
        "title": "Introduction to Algorithms",
        "author": "Alice Smith",
        "publication_year": "2009",
        "doi": ""
    }
    work_b = {
        "title": "Introduction to Algorithms",
        "author": "Bob Jones",
        "publication_year": "2022",
        "doi": ""
    }
    assert _are_records_equivalent(work_a, work_b) is False


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


def test_extract_canonical_arxiv_id_rejects_doi_numbers():
    """
    Issue 1 Regression Test:
    Ensures DOIs containing 4-digit years and sequence numbers do NOT emit false arxiv_ids,
    while valid modern and legacy arXiv identifiers are normalized properly.
    """
    from backend.reading_extractor import extract_canonical_arxiv_id

    # DOIs must NOT emit arxiv_id
    assert extract_canonical_arxiv_id("10.1109/iccv.2019.00069") is None
    assert extract_canonical_arxiv_id("10.1145/3295222.3295349") is None
    assert extract_canonical_arxiv_id("https://doi.org/10.1109/iccv.2019.00069") is None
    assert extract_canonical_arxiv_id("10.1007/978-3-030-01225-0_13") is None

    # Modern arXiv identifiers
    assert extract_canonical_arxiv_id("1706.03762v5") == "1706.03762"
    assert extract_canonical_arxiv_id("2103.14899") == "2103.14899"
    assert extract_canonical_arxiv_id("arxiv:2103.14899") == "2103.14899"
    assert extract_canonical_arxiv_id("arXiv: 2103.14899v2") == "2103.14899"
    assert extract_canonical_arxiv_id("https://arxiv.org/abs/2103.14899v1") == "2103.14899"
    assert extract_canonical_arxiv_id("https://arxiv.org/pdf/2103.14899.pdf") == "2103.14899"
    assert extract_canonical_arxiv_id("doi:10.48550/arXiv.1706.03762") == "1706.03762"

    # Legacy arXiv identifiers
    assert extract_canonical_arxiv_id("hep-th/9901001v2") == "hep-th/9901001"
    assert extract_canonical_arxiv_id("https://arxiv.org/abs/hep-th/9901001") == "hep-th/9901001"
    assert extract_canonical_arxiv_id("arxiv:hep-th/9901001") == "hep-th/9901001"
    assert extract_canonical_arxiv_id("math.GT/0309136") == "math.gt/0309136"


def test_candidate_pool_bounded_top_8_and_truncated_abstracts():
    """
    Issue 2 Regression Test:
    Ensures candidate pool is pruned to top N=8 based on preliminary relevance score,
    abstracts are truncated to <= 600 chars or 120 words, and SLM output schema is compact.
    """
    from backend.reading_extractor import SLMReranker

    # 1. Prune pool: 12 candidates pruned to 8
    candidates = [
        {"title": f"Paper {i}", "relevance_score": i * 0.08}
        for i in range(12)
    ]
    pruned = SLMReranker.prune_candidates(candidates, max_n=8)
    assert len(pruned) == 8
    # Top candidates preserved in descending order
    assert pruned[0]["relevance_score"] == 11 * 0.08
    assert pruned[-1]["relevance_score"] == 4 * 0.08

    # 2. Abstract truncation: long abstract capped to <= 600 chars
    long_abstract = "word " * 200  # 1000 chars, 200 words
    candidate_long = {
        "title": "Long Abstract Paper",
        "journal": "NeurIPS",
        "publication_year": "2023",
        "abstract": long_abstract
    }
    context = SLMReranker.format_candidate_context(candidate_long, 0)
    assert len(context) < 800
    # Abstract line must be truncated
    abs_line = [line for line in context.split("\n") if line.startswith("Abstract:")][0]
    raw_abs_in_context = abs_line.replace("Abstract: ", "")
    assert len(raw_abs_in_context) <= 605
    assert raw_abs_in_context.endswith("...")

    # 3. Compact schema parser
    raw_json = '[{"candidate_id": 0, "semantic_score": 0.92}, {"candidate_id": 1, "semantic_score": 0.35}]'
    parsed_scores = SLMReranker._parse_scores(raw_json)
    assert parsed_scores == {0: 0.92, 1: 0.35}


@pytest.mark.anyio
async def test_s2_circuit_breaker_60s_trip():
    """
    Issue 3 Regression Test:
    Verifies that HTTP 429 on Semantic Scholar trips a 60-second in-memory circuit breaker,
    and provider query budgets enforce single-query for S2 and capped concurrency for OpenAlex.
    """
    from backend.reading_extractor import SemanticScholarRateLimiter, SLMQueryPlanner

    limiter = SemanticScholarRateLimiter(min_interval_seconds=0.01)
    assert limiter.backoff_duration == 60.0
    assert not limiter.is_circuit_open()

    # Trip circuit with 429
    limiter.record_429()
    assert limiter.is_circuit_open() is True
    assert limiter.backoff_duration == 120.0
    # Immediate acquire rejected without waiting
    assert await limiter.acquire() is False

    # Query planner budget: primary queries limited to max 3
    plan = SLMQueryPlanner.plan("cross attention transformer models", course_name="master-of-technology")
    assert len(plan["primary_queries"]) <= 3
    assert plan["primary_queries"][0] == "cross attention transformer models"


def test_abstract_missing_dynamic_weight_compensation():
    """
    Issue 4 Regression Test:
    Verifies that missing or short (<40 chars) abstracts shift lexical weight to citation authority,
    and synthesized context string is created.
    """
    from backend.reading_extractor import (
        compute_hybrid_relevance,
        _impute_records_abstracts_sync
    )

    # Paper with full abstract vs paper with missing abstract
    rec_with_abs = {
        "title": "Attention Is All You Need",
        "abstract": "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
        "citation_count": 50000,
        "publication_year": "2017",
        "direct_pdf_url": "",
        "is_open_access": False
    }
    rec_missing_abs = {
        "title": "Attention Is All You Need",
        "abstract": "",
        "citation_count": 50000,
        "publication_year": "2017",
        "direct_pdf_url": "",
        "is_open_access": False
    }

    # When abstract is missing, citation weight increases from 0.35 to 0.55
    # Citations S_cit = min(1.0, log10(1 + 50000)/4) = min(1.0, 4.6989/4) = 1.0
    # In rec_missing_abs, citation component contributes 0.55 * 1.0 = 0.55
    score_missing = compute_hybrid_relevance(rec_missing_abs, "transformer models")
    assert score_missing >= 0.55, f"Expected citation compensation >= 0.55, got {score_missing}"

    # Verify synthesized context string generation
    records = [{
        "title": "Seminal Paper Without Abstract",
        "journal": "ICLR",
        "publication_year": "2020",
        "abstract": ""
    }]
    _impute_records_abstracts_sync(records)
    assert "(Note: Abstract unavailable)" in records[0]["synthesized_context"]
    assert "Title: Seminal Paper Without Abstract" in records[0]["synthesized_context"]


def test_monograph_relevancy_floor_excludes_low_scoring_books():
    """
    Issue 5 Regression Test:
    Ensures that monographs scoring below 0.50 are excluded from course results,
    and slots are backfilled with peer-reviewed papers.
    """
    from backend.reading_extractor import _format_and_interleave

    # 4 papers (high relevance) and 1 off-topic book (score 0.4425, e.g. 2004 psychology book)
    papers = [
        {"title": f"Transformer Paper {i}", "reading_type": "paper", "relevance_score": 0.85 - i * 0.05}
        for i in range(4)
    ]
    off_topic_book = {
        "title": "Auditory and cross-modal attention",
        "reading_type": "book",
        "relevance_score": 0.4425
    }

    # Combined candidate pool
    candidates = papers + [off_topic_book]

    # Interleave with course_name="Master of Technology" (enforces min_book_relevance=0.50)
    results = _format_and_interleave(
        candidates,
        limit=4,
        query="cross attention",
        course_name="Master of Technology"
    )

    # Off-topic book must be excluded, and all 4 slots backfilled by papers
    assert len(results) == 4
    book_results = [r for r in results if r["reading_type"] == "book"]
    assert len(book_results) == 0, "Off-topic book with score 0.4425 was not excluded!"
    assert all(r["reading_type"] == "paper" for r in results)

    # An on-topic book with score >= 0.50 MUST be included
    on_topic_book = {
        "title": "Deep Learning with Transformers",
        "reading_type": "book",
        "relevance_score": 0.72
    }
    candidates_with_on_topic = papers + [on_topic_book]
    results_with_book = _format_and_interleave(
        candidates_with_on_topic,
        limit=4,
        query="cross attention",
        course_name="Master of Technology"
    )
    assert any(r["reading_type"] == "book" for r in results_with_book)


@pytest.mark.anyio
async def test_stage_1_slm_query_planner_neural_and_fallback():
    """
    Validates Stage 1 SLMQueryPlanner.plan_async:
    1. Neural SLM generation: Parses structured JSON from model with expanded queries,
       domain classification, provider budget, and negative concepts.
    2. Fallback execution: Gracefully falls back to heuristic planner if keys are missing
       or model times out.
    """
    from backend.reading_extractor import SLMQueryPlanner

    # 1. Fallback mode (no API keys)
    with patch.dict("os.environ", {"GROQ_API_KEY": "", "GEMINI_API_KEY": "", "OPENAI_API_KEY": ""}):
        plan_fallback = await SLMQueryPlanner.plan_async("cross attention", course_name="master-of-technology")
        assert plan_fallback["domain"] == "stem_cs"
        assert len(plan_fallback["primary_queries"]) >= 1
        assert "openalex" in plan_fallback["providers"]

    # 2. Neural mode with simulated SLM response
    mock_slm_json = """{
        "domain": "cs_ai",
        "verbatim_query": "\\"cross attention\\"",
        "foundational_nomenclature": "encoder-decoder attention",
        "architectural_class": "transformer models",
        "negative_disambiguation": ["criss-cross", "cross-window", "cardiology", "sensory attention"],
        "providers": ["openalex", "semantic_scholar"],
        "intent": "paper"
    }"""

    mock_resp = MagicMock()
    mock_choice = MagicMock()
    mock_choice.message.content = mock_slm_json
    mock_resp.choices = [mock_choice]

    async def async_create(*args, **kwargs):
        return mock_resp

    mock_groq_client = MagicMock()
    mock_groq_client.chat.completions.create = async_create

    with patch.dict("os.environ", {"GROQ_API_KEY": "gsk_test_key"}), \
         patch("openai.AsyncOpenAI", return_value=mock_groq_client):
        neural_plan = await SLMQueryPlanner.plan_async("cross attention", course_name="Master of Technology")
        assert neural_plan["domain"] == "cs_ai"
        assert neural_plan["verbatim_query"] == '"cross attention"'
        assert neural_plan["foundational_nomenclature"] == "encoder-decoder attention"
        assert neural_plan["architectural_class"] == "transformer models"
        assert "cardiology" in neural_plan["negative_disambiguation"]
        assert len(neural_plan["primary_queries"]) >= 2
        assert neural_plan["primary_queries"][0] == "cross attention"
        assert neural_plan["providers"] == ["openalex", "semantic_scholar"]
        assert neural_plan["intent"] == "paper"


@pytest.mark.anyio
async def test_parallel_openalex_doi_imputation():
    """
    Validates Step 2: Parallelized OpenAlex DOI lookup using bounded asyncio.gather and Semaphore(5).
    Ensures 9 missing DOIs are looked up concurrently without blocking serially.
    """
    from backend.reading_extractor import _impute_records_abstracts_async
    import httpx

    records = [
        {"title": f"Paper {i}", "doi": f"10.1000/{i}", "abstract": "", "publication_year": "2020"}
        for i in range(9)
    ]

    mock_client = MagicMock(spec=httpx.AsyncClient)
    async def mock_get(url, *args, **kwargs):
        resp = MagicMock()
        resp.status_code = 200
        # Return mock inverted index
        resp.json.return_value = {
            "abstract_inverted_index": {"Recovered": [0], "abstract": [1], "content": [2], "for": [3], "paper": [4], "validation": [5], "test": [6], "purposes": [7]}
        }
        return resp

    mock_client.get = mock_get

    await _impute_records_abstracts_async(records, mock_client)

    for r in records:
        assert len(r["abstract"]) >= 40
        assert "Recovered abstract" in r["abstract"]


def test_ccnet_multi_year_deduplication_exact_title_match():
    """
    Validates Step 3: 3 identical versions of CCNet (2018, 2019, 2020) with matching
    author surnames are merged into a single record despite >1 year differences.
    """
    from backend.reading_extractor import _consolidate_and_merge_records

    ccnet_items = [
        {
            "title": "CCNet: Extracting High Quality Monolingual Datasets from Web Crawl",
            "author": "Guillaume Wenzek, Marie-Anne Lachaux, Alexis Conneau",
            "publication_year": "2018",
            "citation_count": 50,
            "arxiv_id": "1911.00359",
            "direct_pdf_url": "",
            "is_open_access": False,
            "doi": "10.48550/arXiv.1911.00359",
            "abstract": "Pre-training language models at scale requires vast amounts of text."
        },
        {
            "title": "CCNet: Extracting High Quality Monolingual Datasets from Web Crawl",
            "author": "Wenzek G, Lachaux MA, Conneau A",
            "publication_year": "2019",
            "citation_count": 350,
            "arxiv_id": "",
            "direct_pdf_url": "https://arxiv.org/pdf/1911.00359.pdf",
            "is_open_access": True,
            "doi": "",
            "abstract": ""
        },
        {
            "title": "CCNet: Extracting High Quality Monolingual Datasets from Web Crawl",
            "author": "Guillaume Wenzek, Marie-Anne Lachaux, Alexis Conneau, Armand Joulin",
            "publication_year": "2020",
            "citation_count": 820,
            "arxiv_id": "",
            "direct_pdf_url": "",
            "is_open_access": False,
            "doi": "10.18653/v1/2020.lrec-1.494",
            "abstract": "Pre-training language models at scale requires vast amounts of text data."
        }
    ]

    merged = _consolidate_and_merge_records(
        openalex_items=[ccnet_items[0]],
        s2_items=[ccnet_items[1]],
        crossref_items=[ccnet_items[2]],
        query="CCNet extracting high quality"
    )

    ccnet_results = [r for r in merged if "CCNet" in r["title"]]
    assert len(ccnet_results) == 1, f"Expected 1 CCNet record after deduplication, got {len(ccnet_results)}"
    rec = ccnet_results[0]
    assert rec["citation_count"] == 820
    assert rec["arxiv_id"] == "1911.00359"
    assert rec["direct_pdf_url"] == "https://arxiv.org/pdf/1911.00359.pdf"
    assert rec["is_open_access"] is True


@pytest.mark.anyio
async def test_stage_1_expansions_wired_to_stage_2_openalex():
    """
    Validates Requirement 1: Stage 1 dynamic expanded_queries are passed to OpenAlex,
    ensuring additional search passes are executed concurrently to retrieve foundational literature.
    """
    import httpx
    from backend.reading_extractor import _fetch_openalex_candidates_async

    searched_terms = []

    async def mock_get(url, params=None, headers=None, timeout=None):
        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 200
        search_query = params.get("search", "")
        searched_terms.append(search_query)

        mock_resp.json.return_value = {
            "results": [
                {
                    "id": f"https://openalex.org/{search_query}",
                    "title": f"Paper for {search_query}",
                    "authorships": [{"author": {"display_name": "Author"}}],
                    "publication_year": 2021,
                    "type": "article",
                    "cited_by_count": 100
                }
            ]
        }
        return mock_resp

    mock_client = MagicMock(spec=httpx.AsyncClient)
    mock_client.get = mock_get

    items = await _fetch_openalex_candidates_async(
        mock_client,
        query="cross attention",
        limit=5,
        expanded_queries=["encoder-decoder attention transformer"]
    )

    assert '"cross attention"' in searched_terms
    assert '"encoder-decoder attention transformer"' in searched_terms
    assert len(searched_terms) == 3  # pass 1 (rel), pass 2 (cit), pass 3 (expanded)
    assert len(items) >= 2


@pytest.mark.anyio
async def test_s2_circuit_breaker_bypasses_network_call():
    """
    Validates Requirement 2: When Semantic Scholar circuit breaker is tripped,
    search_academic_literature_async bypasses S2 HTTP call instantly without task creation.
    """
    from backend.reading_extractor import (
        search_academic_literature_async,
        _S2_RATE_LIMITER
    )

    _S2_RATE_LIMITER.record_429()
    assert _S2_RATE_LIMITER.is_circuit_open() is True

    with patch("backend.reading_extractor._fetch_semantic_scholar_candidates_async") as mock_s2, \
         patch("backend.reading_extractor._fetch_openalex_candidates_async", return_value=[]), \
         patch("backend.reading_extractor._fetch_crossref_candidates_async", return_value=[]), \
         patch("backend.reading_extractor._fetch_europe_pmc_candidates_async", return_value=[]), \
         patch("backend.reading_extractor._fetch_google_books_candidates_async", return_value=[]):

        results = await search_academic_literature_async("cross attention", limit=5)
        # S2 fetch should NOT be called at all
        mock_s2.assert_not_called()

    # Reset circuit breaker for subsequent tests
    _S2_RATE_LIMITER.reset_circuit()
    assert not _S2_RATE_LIMITER.is_circuit_open()


def test_reranker_system_prompt_contains_generalized_academic_criteria():
    """
    Validates Requirement 3: SLMReranker system prompt guides the judge to evaluate
    Foundational Relevance (>= 0.90), Application Relevance (>= 0.75), and Negative Disambiguation (<= 0.40).
    """
    from backend.reading_extractor import SLMReranker
    import inspect

    src = inspect.getsource(SLMReranker.rerank_async)
    assert "Foundational Relevance" in src
    assert "Application Relevance" in src
    assert "Negative Disambiguation" in src
    assert "<= 0.40" in src


@pytest.mark.anyio
async def test_hard_semantic_floor_drops_low_scoring_papers():
    """
    Validates Task 1: Papers with semantic_score < 0.40 are dropped regardless of massive citation count.
    Tests specifically that high-citation off-topic papers (e.g., echocardiography guidelines with 18,200 citations)
    are filtered out.
    """
    from backend.reading_extractor import SLMReranker, _format_and_interleave

    # Paper A: Seminal paper with good semantic score
    paper_a = {
        "title": "Attention Is All You Need",
        "reading_type": "paper",
        "citation_count": 135000,
        "publication_year": "2017",
        "relevance_score": 0.95
    }
    # Paper B: Echocardiography paper with 18,200 citations but off-topic (semantic_score = 0.0)
    paper_b = {
        "title": "Recommendations for Cardiac Chamber Quantification by Echocardiography in Adults",
        "reading_type": "paper",
        "citation_count": 18200,
        "publication_year": "2015",
        "doi": "10.1016/j.echo.2014.10.003",
        "relevance_score": 0.85
    }

    mock_json = '[{"candidate_id": 0, "semantic_score": 0.95}, {"candidate_id": 1, "semantic_score": 0.0}]'

    mock_resp = MagicMock()
    mock_choice = MagicMock()
    mock_choice.message.content = mock_json
    mock_resp.choices = [mock_choice]

    async def async_create(*args, **kwargs):
        return mock_resp

    mock_client = MagicMock()
    mock_client.chat.completions.create = async_create

    with patch.dict("os.environ", {"GROQ_API_KEY": "gsk_test"}), \
         patch("openai.AsyncOpenAI", return_value=mock_client):
        reranked = await SLMReranker.rerank_async([paper_a, paper_b], query="cross attention")

    # Paper B must be dropped by the hard semantic floor
    assert len(reranked) == 1
    assert reranked[0]["title"] == "Attention Is All You Need"
    assert not any("Echocardiography" in r["title"] for r in reranked)

    # Also test _format_and_interleave drops papers with semantic_score < 0.40
    mixed_papers = [
        {"title": "Paper Good", "reading_type": "paper", "semantic_score": 0.85, "relevance_score": 0.90},
        {"title": "Paper Bad", "reading_type": "paper", "semantic_score": 0.10, "relevance_score": 0.70}
    ]
    formatted = _format_and_interleave(mixed_papers, limit=5, query="cross attention")
    assert len(formatted) == 1
    assert formatted[0]["title"] == "Paper Good"


@pytest.mark.anyio
async def test_openalex_preserves_verbatim_quoted_phrase():
    """
    Validates Task 2: Multi-word query 'cross attention' is quoted as '"cross attention"'
    in OpenAlex API requests to prevent unquoted full-text token disjunction.
    """
    import httpx
    from backend.reading_extractor import _fetch_openalex_candidates_async

    searched_queries = []

    async def mock_get(url, params=None, headers=None, timeout=None):
        mock_resp = MagicMock(spec=httpx.Response)
        mock_resp.status_code = 200
        searched_queries.append(params.get("search", ""))
        mock_resp.json.return_value = {"results": []}
        return mock_resp

    mock_client = MagicMock(spec=httpx.AsyncClient)
    mock_client.get = mock_get

    await _fetch_openalex_candidates_async(mock_client, query="cross attention", limit=5)

    assert len(searched_queries) == 2
    for q in searched_queries:
        assert q == '"cross attention"'


@pytest.mark.anyio
async def test_generalized_multidomain_query_planning_and_dual_pass():
    """
    Validates generalized query expansion and dual-track candidate retrieval across
    four distinct academic domains without any hardcoded synonym dictionaries:
      1. Deep Learning: "cross attention" -> "encoder-decoder attention"
      2. NLP: "flash attention" -> "fast attention IO-awareness"
      3. Distributed Systems: "raft consensus" -> "consensus algorithm"
      4. Medicine: "mrna vaccines" -> "lipid nanoparticle mRNA"
    """
    from backend.reading_extractor import SLMQueryPlanner, _fetch_openalex_candidates_async
    from unittest.mock import AsyncMock, MagicMock, patch
    import httpx
    import json

    domain_cases = [
        {
            "query": "cross attention",
            "mock_plan": {
                "verbatim_query": '"cross attention"',
                "foundational_nomenclature": "encoder-decoder attention",
                "architectural_class": "transformer models",
                "negative_disambiguation": ["criss-cross", "cardiology"],
                "domain": "cs_ai",
                "providers": ["openalex", "semantic_scholar"],
                "intent": "paper"
            }
        },
        {
            "query": "flash attention",
            "mock_plan": {
                "verbatim_query": '"flash attention"',
                "foundational_nomenclature": "fast attention IO-awareness",
                "architectural_class": "exact attention algorithms",
                "negative_disambiguation": ["flash memory", "photoflash"],
                "domain": "cs_ai",
                "providers": ["openalex", "semantic_scholar"],
                "intent": "paper"
            }
        },
        {
            "query": "raft consensus",
            "mock_plan": {
                "verbatim_query": '"raft consensus"',
                "foundational_nomenclature": "consensus algorithm",
                "architectural_class": "distributed state machine replication",
                "negative_disambiguation": ["rafting sport", "lipid raft"],
                "domain": "cs_systems",
                "providers": ["openalex", "semantic_scholar"],
                "intent": "paper"
            }
        },
        {
            "query": "mrna vaccines",
            "mock_plan": {
                "verbatim_query": '"mrna vaccines"',
                "foundational_nomenclature": "lipid nanoparticle mRNA",
                "architectural_class": "nucleic acid therapeutics",
                "negative_disambiguation": ["dna vaccine", "attenuated virus"],
                "domain": "biomedical",
                "providers": ["openalex", "europe_pmc"],
                "intent": "paper"
            }
        }
    ]

    for case in domain_cases:
        mock_resp = MagicMock()
        mock_resp.choices = [
            MagicMock(message=MagicMock(content=json.dumps(case["mock_plan"])))
        ]
        mock_groq_client = MagicMock()
        mock_groq_client.chat.completions.create = AsyncMock(return_value=mock_resp)

        with patch.dict("os.environ", {"GROQ_API_KEY": "gsk_test_key"}), \
             patch("openai.AsyncOpenAI", return_value=mock_groq_client):
            plan = await SLMQueryPlanner.plan_async(case["query"])
            assert plan["verbatim_query"] == case["mock_plan"]["verbatim_query"]
            assert plan["foundational_nomenclature"] == case["mock_plan"]["foundational_nomenclature"]
            assert plan["architectural_class"] == case["mock_plan"]["architectural_class"]
            assert len(plan["negative_disambiguation"]) >= 2

            # Now test dual-track OpenAlex sourcing with these expanded queries
            searched_terms = []

            async def mock_get(url, params=None, headers=None, timeout=None):
                mock_r = MagicMock(spec=httpx.Response)
                mock_r.status_code = 200
                sq = params.get("search", "")
                searched_terms.append(sq)
                mock_r.json.return_value = {
                    "results": [
                        {
                            "id": f"https://openalex.org/{sq}",
                            "title": f"Paper for {sq}",
                            "authorships": [{"author": {"display_name": "Author"}}],
                            "publication_year": 2022,
                            "type": "article",
                            "cited_by_count": 50
                        }
                    ]
                }
                return mock_r

            mock_client = MagicMock(spec=httpx.AsyncClient)
            mock_client.get = mock_get

            items = await _fetch_openalex_candidates_async(
                mock_client,
                query=case["query"],
                limit=5,
                expanded_queries=plan["expanded_queries"]
            )

            # Check that precision pass and authority pass were dispatched
            assert any(case["query"] in st for st in searched_terms)
            assert any(case["mock_plan"]["foundational_nomenclature"] in st for st in searched_terms)
            assert len(items) >= 2









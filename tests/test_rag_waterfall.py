import unittest
import json
from unittest.mock import patch, MagicMock
from backend.rag_engine import pinecone_rag_engine

class TestRAGWaterfall(unittest.TestCase):

    @patch("backend.algolia_service.algolia_service.search")
    @patch("backend.database.db_manager.get_saved_video")
    def test_search_course_lectures_returns_cross_lecture_citations(self, mock_get_video, mock_algolia_search):
        """Tier 1: Course-wide cross-lecture search should locate concepts in other sessions and tag cross_lecture=True."""
        mock_get_video.return_value = {
            "title": "Introduction to Speech and Natural Language Processing Live session -3",
            "course_name": "Introduction to Speech and Natural Language Processing"
        }
        mock_algolia_search.return_value = [
            {
                "video_id": "1231770901",
                "video_title": "Introduction to Speech and Natural Language Processing Live session -1",
                "timestamp": "14:20",
                "text": "ELIZA was developed by Joseph Weizenbaum at MIT in 1966 simulating a psychotherapist."
            }
        ]

        result_str, citations, web_sources = pinecone_rag_engine.execute_tool(
            tool_name="search_course_lectures",
            arguments={"query": "ELIZA psychotherapist", "top_k": 3},
            target_video_id="1231770905",
            lecture_title="Introduction to Speech and Natural Language Processing Live session -3"
        )

        res_items = json.loads(result_str)
        self.assertEqual(len(res_items), 1)
        self.assertEqual(res_items[0]["video_id"], "1231770901")
        self.assertEqual(res_items[0]["timestamp"], "[14:20]")

        self.assertEqual(len(citations), 1)
        self.assertEqual(citations[0]["video_id"], "1231770901")
        self.assertTrue(citations[0].get("cross_lecture"))
        self.assertIn("Live session -1", citations[0]["video_title"])

    @patch("backend.web_search.search_web_for_context")
    def test_search_web_context_tool_executes(self, mock_web_search):
        """Tier 3: search_web_context returns external web hits with titles, snippets, and URLs."""
        mock_web_search.return_value = [
            {
                "title": "ELIZA - Computer Program",
                "snippet": "ELIZA simulated a Rogerian psychotherapist in 1966.",
                "url": "https://en.wikipedia.org/wiki/ELIZA"
            }
        ]

        result_str, citations, web_sources = pinecone_rag_engine.execute_tool(
            tool_name="search_web_context",
            arguments={"search_query": "early NLP system mimicking a psychotherapist"},
            target_video_id="1231770905",
            lecture_title="NLP Session 3"
        )

        hits = json.loads(result_str)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["title"], "ELIZA - Computer Program")
        self.assertEqual(len(web_sources), 1)
        self.assertEqual(web_sources[0]["url"], "https://en.wikipedia.org/wiki/ELIZA")

    @patch("backend.web_search.search_web_for_context")
    @patch("requests.post")
    def test_query_rag_autonomous_web_fallback_when_unanswered(self, mock_post, mock_web_search):
        """When an agent loop yields no final answer, autonomous fallback activates web grounding with boundary notice."""
        mock_web_search.return_value = [
            {
                "title": "ELIZA History",
                "snippet": "ELIZA was created by Joseph Weizenbaum at MIT in 1966.",
                "url": "https://en.wikipedia.org/wiki/ELIZA"
            }
        ]

        # 1st call (agent step without tool calls and empty content)
        mock_resp1 = MagicMock()
        mock_resp1.status_code = 200
        mock_resp1.json.return_value = {
            "choices": [{"message": {"content": "", "tool_calls": []}}]
        }

        # 2nd call (autonomous web fallback synthesis)
        mock_resp2 = MagicMock()
        mock_resp2.status_code = 200
        mock_resp2.json.return_value = {
            "choices": [{
                "message": {
                    "content": "⚠️ **Course Boundary Notice**: This topic is not covered in this lecture. Grounded in standard academic literature: The system is ELIZA, developed by Joseph Weizenbaum at MIT in 1966."
                }
            }]
        }

        mock_post.side_effect = [mock_resp1, mock_resp2]

        with patch.dict("os.environ", {"GROQ_API_KEY": "dummy_groq_key"}):
            rag_res = pinecone_rag_engine.query_rag(
                query="what is early NLP system mimicking a phsycotherapist",
                video_id="1231770905",
                video_title="Introduction to Speech and Natural Language Processing Live session -3",
                enable_web_search=True
            )

        self.assertIn("Course Boundary Notice", rag_res["answer"])
        self.assertIn("ELIZA", rag_res["answer"])
        self.assertEqual(len(rag_res["web_sources"]), 1)
        self.assertEqual(rag_res["web_sources"][0]["url"], "https://en.wikipedia.org/wiki/ELIZA")
        # Assert that citations are suppressed on boundary notices
        self.assertEqual(rag_res["citations"], [])

    def test_filter_citations_suppresses_irrelevant_chunks_on_negative_answer(self):
        """When an answer states topic was not identified or boundary notice, raw candidate chunks must be suppressed."""
        answer = "The requested topic was not explicitly identified in the transcript for 'Introduction to Speech and Natural Language Processing Live session -3(20 / 9 / 2026)'."
        candidate_citations = [
            {"timestamp": "1:01:56", "text": "Unrelated chunk 1"},
            {"timestamp": "1:07:31", "text": "Unrelated chunk 2"},
            {"timestamp": "30:42", "text": "Unrelated chunk 3"}
        ]

        filtered = pinecone_rag_engine._filter_and_deduplicate_citations(
            citations=candidate_citations,
            answer=answer,
            target_video_id="1231770905"
        )
        self.assertEqual(filtered, [])

    def test_filter_citations_keeps_only_referenced_timestamps_and_deduplicates(self):
        """When the answer cites specific timestamps, only those timestamps are returned with zero duplicates."""
        answer = "ELIZA was introduced by Joseph Weizenbaum as explained at [14:20]. Later at [31:46], dialog systems were expanded."
        candidate_citations = [
            {"timestamp": "14:20", "text": "ELIZA mention", "video_id": "123"},
            {"timestamp": "14:20", "text": "ELIZA duplicate from step 2", "video_id": "123"},
            {"timestamp": "31:46", "text": "Dialog expansion", "video_id": "123"},
            {"timestamp": "1:01:56", "text": "Unrelated topic", "video_id": "123"},
            {"timestamp": "53:41", "text": "Another unrelated chunk", "video_id": "123"}
        ]

        filtered = pinecone_rag_engine._filter_and_deduplicate_citations(
            citations=candidate_citations,
            answer=answer,
            target_video_id="123"
        )
        self.assertEqual(len(filtered), 2)
        timestamps = [c["timestamp"] for c in filtered]
        self.assertIn("14:20", timestamps)
        self.assertIn("31:46", timestamps)
        self.assertNotIn("1:01:56", timestamps)
        self.assertNotIn("53:41", timestamps)

if __name__ == "__main__":
    unittest.main()

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

    def test_is_holistic_query_detection(self):
        """Holistic queries (core concepts, definitions, summary, outline) must be identified accurately."""
        holistic_queries = [
            "What are the core concepts and definitions?",
            "Can you give me the key concepts of this lecture?",
            "What are the main definitions taught by the professor?",
            "Give me a summary of this lecture",
            "What is this lecture about?",
            "outline",
            "quiz me on the material",
            "What are the main equations and formulas?"
        ]
        for q in holistic_queries:
            self.assertTrue(pinecone_rag_engine.is_holistic_query(q), f"Failed to identify holistic query: {q}")

        specific_queries = [
            "What did Joseph Weizenbaum create in 1966?",
            "Explain how backpropagation computes gradients with the chain rule",
            "ELIZA psychotherapist",
            "Why is softmax used instead of sigmoid in multi-class classification?"
        ]
        for q in specific_queries:
            self.assertFalse(pinecone_rag_engine.is_holistic_query(q), f"False positive holistic query: {q}")

    @patch("backend.database.db_manager.get_saved_video")
    def test_get_lecture_outline_falls_back_to_cues_gracefully(self, mock_get_video):
        """When summarySections is missing, get_lecture_outline segments cues into chapters without throwing."""
        mock_get_video.return_value = {
            "title": "Machine Learning Lecture 1",
            "cues": [
                {"time": "00:00", "text": "Welcome to machine learning lecture one."},
                {"time": "05:10", "text": "Supervised learning uses labeled training datasets."},
                {"time": "15:30", "text": "Linear regression models continuous targets using mean squared error."},
                {"time": "30:00", "text": "Gradient descent iteratively updates weights towards minimum loss."}
            ]
        }

        res_str, citations, _ = pinecone_rag_engine.execute_tool(
            tool_name="get_lecture_outline",
            arguments={"video_id": "ml-101"},
            target_video_id="ml-101",
            lecture_title="Machine Learning Lecture 1"
        )
        outline = json.loads(res_str)
        self.assertTrue(len(outline) >= 1)
        self.assertTrue(len(citations) >= 1)
        self.assertIn("00:00", citations[0]["timestamp"])

    @patch("backend.database.db_manager.get_saved_video")
    def test_search_transcript_holistic_sampling_and_stopword_filtering(self, mock_get_video):
        """search_transcript ignores stopwords and samples cues chronologically for holistic queries."""
        mock_get_video.return_value = {
            "title": "Introduction to NLP",
            "cues": [
                {"time": "01:00", "text": "Today we cover morphological parsing and syntax."},
                {"time": "10:00", "text": "Context free grammars define the rules of hierarchical phrases."},
                {"time": "25:00", "text": "The CKY algorithm performs bottom-up dynamic programming parsing."}
            ]
        }

        res_str, citations, _ = pinecone_rag_engine.execute_tool(
            tool_name="search_transcript",
            arguments={"query": "What are the core concepts and definitions?", "top_k": 3},
            target_video_id="nlp-101",
            lecture_title="Introduction to NLP"
        )
        hits = json.loads(res_str)
        self.assertTrue(len(hits) >= 1)
        self.assertTrue(len(citations) >= 1)

    @patch("backend.database.db_manager.get_saved_video")
    @patch("requests.post")
    def test_query_rag_holistic_core_concepts_synthesizes_without_boundary_notice(self, mock_post, mock_get_video):
        """The AI Tutor must answer 'What are the core concepts and definitions?' grounded in the lecture without boundary notice."""
        mock_get_video.return_value = {
            "title": "Speech Processing Lecture 1",
            "summarySections": [
                {
                    "title": "[00:00 - 15:00] Introduction to Acoustic Phonetics",
                    "points": ["Sound waves and frequency spectrum", "Formants F1 and F2 determine vowel qualities"]
                },
                {
                    "title": "[15:00 - 35:00] Short-Time Fourier Transform",
                    "points": ["Windowing with Hamming window", "Spectrogram calculation with STFT"]
                }
            ],
            "cues": [
                {"time": "00:00", "text": "Introduction to acoustic phonetics and waveforms."},
                {"time": "15:00", "text": "Short-time Fourier transform computes frequency over time."}
            ]
        }

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{
                "message": {
                    "content": (
                        "# Core Concepts and Definitions\n\n"
                        "1. **Acoustic Phonetics** [00:00]: The study of speech sounds as physical sound waves, characterized by formants $F_1$ and $F_2$.\n"
                        "2. **Short-Time Fourier Transform (STFT)** [15:00]: A mathematical representation computed by:\n"
                        "$$\\text{STFT}\\{x[n]\\}(m, \\omega) = \\sum_{n=-\\infty}^{\\infty} x[n] w[n-m] e^{-j\\omega n}$$\n"
                        "where $w[n]$ is the window function."
                    ),
                    "tool_calls": []
                }
            }]
        }
        mock_post.return_value = mock_resp

        with patch.dict("os.environ", {"GROQ_API_KEY": "dummy_groq_key"}):
            rag_res = pinecone_rag_engine.query_rag(
                query="What are the core concepts and definitions?",
                video_id="speech-101",
                video_title="Speech Processing Lecture 1",
                enable_web_search=True
            )

        self.assertNotIn("Course Boundary Notice", rag_res["answer"])
        self.assertIn("Acoustic Phonetics", rag_res["answer"])
        self.assertIn("Short-Time Fourier Transform", rag_res["answer"])
        self.assertTrue(len(rag_res["citations"]) >= 1)
        timestamps = [c["timestamp"] for c in rag_res["citations"]]
        self.assertTrue(any("00:00" in t for t in timestamps))

    @patch("backend.database.db_manager.get_saved_video")
    @patch("requests.post")
    def test_query_rag_tool_execution_error_is_caught_gracefully(self, mock_post, mock_get_video):
        """Tool errors inside the agentic step must be caught and returned as JSON tool responses, not crashing provider loop."""
        mock_get_video.return_value = {"title": "Test Lecture", "cues": []}

        # Step 1: Model makes an invalid tool call
        mock_resp1 = MagicMock()
        mock_resp1.status_code = 200
        mock_resp1.json.return_value = {
            "choices": [{
                "message": {
                    "content": "",
                    "tool_calls": [{
                        "id": "call_1",
                        "function": {
                            "name": "unknown_tool",
                            "arguments": "{}"
                        }
                    }]
                }
            }]
        }

        # Step 2: Model continues after tool error and answers
        mock_resp2 = MagicMock()
        mock_resp2.status_code = 200
        mock_resp2.json.return_value = {
            "choices": [{
                "message": {
                    "content": "The concept was introduced at [02:15] in the lecture.",
                    "tool_calls": []
                }
            }]
        }

        mock_post.side_effect = [mock_resp1, mock_resp2]

        with patch.dict("os.environ", {"GROQ_API_KEY": "dummy_groq_key"}):
            rag_res = pinecone_rag_engine.query_rag(
                query="Tell me about the concept",
                video_id="test-101",
                video_title="Test Lecture"
            )

        self.assertIn("02:15", rag_res["answer"])

if __name__ == "__main__":
    unittest.main()

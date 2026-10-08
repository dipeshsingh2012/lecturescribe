import unittest
from backend.rag_engine import pinecone_rag_engine

class TestSubmissionEngine(unittest.TestCase):
    def test_clean_for_submission(self):
        raw_text = """Based on the professor's lecture transcript, we can identify:
- **Supervised Learning**: Model learns from labeled data [05:22].
- **Unsupervised Learning**: Clustering patterns [14:40].
```python
def train(): pass
```
Here's what I found regarding machine learning paradigms."""
        
        cleaned = pinecone_rag_engine._clean_for_submission(raw_text, target_words=100)
        
        # Must remove bracketed timestamps
        self.assertNotIn("[05:22]", cleaned)
        self.assertNotIn("[14:40]", cleaned)
        # Must remove markdown symbols
        self.assertNotIn("**", cleaned)
        self.assertNotIn("```", cleaned)
        # Must remove conversational cliches
        self.assertNotIn("Here's what I found", cleaned)

    def test_clean_submission_academic_preamble(self):
        """Verify removal of verbose LLM submission preambles."""
        raw_preamble = (
            "Here is a concise academic submission of around 120 words summarizing the technical "
            "takeaway or solution for this topic: Computer vision has undergone significant "
            "transformations [00:00 - 15:20], evolving from early machine learning to current deep learning techniques."
        )
        cleaned = pinecone_rag_engine._clean_for_submission(raw_preamble, target_words=100)
        self.assertNotIn("Here is a concise academic submission", cleaned)
        self.assertNotIn("[00:00 - 15:20]", cleaned)
        self.assertTrue(cleaned.startswith("Computer vision has undergone"))

    def test_clean_submission_timestamp_ranges(self):
        """Verify bracketed timestamp ranges are removed."""
        text = "Neural networks were introduced [00:00 - 15:30] and convolutional layers [15:30 - 30:00] process features."
        cleaned = pinecone_rag_engine._clean_for_submission(text, target_words=50)
        self.assertNotIn("[00:00 - 15:30]", cleaned)
        self.assertNotIn("[15:30 - 30:00]", cleaned)

    def test_clean_submission_preserves_paragraphs(self):
        """Verify _clean_for_submission keeps paragraph breaks."""
        raw = "First paragraph content.\n\nSecond paragraph content after line break."
        cleaned = pinecone_rag_engine._clean_for_submission(raw, preserve_paragraphs=True)
        self.assertIn("\n\n", cleaned)
        self.assertIn("First paragraph content.", cleaned)
        self.assertIn("Second paragraph content after line break.", cleaned)

    def test_generate_submission_adaptive_comprehensive_target(self):
        """Verify comprehensive summary query uses higher target word count in fallback."""
        import os
        from unittest.mock import patch
        # Long sample text with 500 words
        sample_words = " ".join([f"topic{i}" for i in range(500)]) + "."
        with patch.dict(os.environ, {"GROQ_API_KEY": "", "GEMINI_API_KEY": ""}):
            # Mocking keys to test fallback extraction logic
            with patch.object(os, "getenv", return_value="dummy_key"):
                # With dummy key that fails network, should fall back to local extractor with ~350 words
                result = pinecone_rag_engine.generate_submission_version(
                    sample_words,
                    query="Generate Full Comprehensive Summary"
                )
                self.assertGreaterEqual(result["word_count"], 300)

    def test_clean_submission_three_part_timestamps_and_ocr_artifacts(self):
        """Verify three-part timestamps, comma lists, and CJK/OCR glitches are cleanly removed."""
        raw = "Errors (|Y_i - Y_pred住宅|) were discussed [1:30:01, 1:33:03] with non-breaking\u00a0space."
        cleaned = pinecone_rag_engine._clean_for_submission(raw)
        self.assertNotIn("[1:30:01, 1:33:03]", cleaned)
        self.assertNotIn("住宅", cleaned)
        self.assertNotIn("\u00a0", cleaned)
        self.assertIn("Errors (|Y_i - Y_pred|) were discussed", cleaned)

    def test_deterministic_embedding_generation(self):
        """Verify _generate_embedding is deterministic and 768-dimensional."""
        v1 = pinecone_rag_engine._generate_embedding("machine learning regression paradigms")
        v2 = pinecone_rag_engine._generate_embedding("machine learning regression paradigms")
        self.assertEqual(len(v1), 768)
        self.assertEqual(v1, v2)
        # Verify vector norm is ~1.0
        import math
        norm = math.sqrt(sum(x * x for x in v1))
        self.assertAlmostEqual(norm, 1.0, places=4)

    def test_generate_submission_fail_fast_no_keys(self):
        """Verify fail-fast exception when no LLM keys are configured."""
        import os
        from unittest.mock import patch
        with patch.dict(os.environ, {"HUGGINGFACE_TOKEN": "", "GROQ_API_KEY": "", "GEMINI_API_KEY": "", "OPENAI_API_KEY": ""}):
            with self.assertRaises(RuntimeError):
                pinecone_rag_engine.generate_submission_version("Sample text", "dummy_video")

if __name__ == "__main__":
    unittest.main()



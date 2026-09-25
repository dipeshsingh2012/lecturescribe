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

    def test_generate_submission_fail_fast_no_keys(self):
        """Verify fail-fast exception when no LLM keys are configured."""
        import os
        from unittest.mock import patch
        with patch.dict(os.environ, {"HUGGINGFACE_TOKEN": "", "GROQ_API_KEY": "", "GEMINI_API_KEY": "", "OPENAI_API_KEY": ""}):
            with self.assertRaises(RuntimeError):
                pinecone_rag_engine.generate_submission_version("Sample text", "dummy_video")

if __name__ == "__main__":
    unittest.main()


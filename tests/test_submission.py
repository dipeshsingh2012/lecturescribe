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

    def test_generate_submission_version_fallback(self):
        sample_answer = """Supervised learning algorithms map inputs to known targets using ground truth labels. In industrial applications, this paradigm powers classification pipelines, regression forecasting, and recommendation systems."""
        
        result = pinecone_rag_engine.generate_submission_version(
            original_text=sample_answer,
            video_id="dummy_video",
            word_count=120
        )
        
        self.assertEqual(result.get("status"), "success")
        self.assertTrue(result.get("submission_text"))
        self.assertGreater(result.get("word_count", 0), 0)
        self.assertNotIn("[", result.get("submission_text"))
        self.assertNotIn("]", result.get("submission_text"))

if __name__ == "__main__":
    unittest.main()

import unittest
from backend.summary_generator import (
    clean_sentence_text,
    is_greeting_or_banter,
    reconstruct_sentences,
    generate_summary_sections,
)

class TestSummaryGenerator(unittest.TestCase):
    def test_clean_sentence_text(self):
        cleaned = clean_sentence_text("basically what we want to discuss here is algorithm design, right?")
        self.assertTrue(cleaned.startswith("What we want to discuss"))
        self.assertTrue(cleaned.endswith("."))

    def test_is_greeting_or_banter(self):
        self.assertTrue(is_greeting_or_banter("Good evening everyone, can you hear me?"))
        self.assertTrue(is_greeting_or_banter("Yes sir, screen visible."))
        self.assertFalse(is_greeting_or_banter("In this section we formalize the theorem proof."))

    def test_reconstruct_sentences(self):
        cues = [
            {"time": "00:01", "text": "We will investigate"},
            {"time": "00:03", "text": "the formal verification of cryptographic protocols."},
        ]
        sentences = reconstruct_sentences(cues)
        self.assertEqual(len(sentences), 1)
        self.assertEqual(sentences[0]["time"], "00:01")
        self.assertIn("cryptographic protocols", sentences[0]["text"])

    def test_generate_summary_sections(self):
        cues = [
            {"time": "00:01", "text": "In this lecture we analyze distributed consistency models and consensus."},
            {"time": "00:15", "text": "The primary objective is understanding Paxos and Raft mechanisms."},
            {"time": "00:30", "text": "How do we guarantee safety under network partitions?"},
            {"time": "00:45", "text": "We observe that state machine replication requires a stable majority."},
        ]
        sections = generate_summary_sections(cues, "Distributed Systems")
        self.assertIsInstance(sections, list)
        self.assertGreater(len(sections), 0)
        self.assertTrue(any("points" in s for s in sections))

if __name__ == "__main__":
    unittest.main()

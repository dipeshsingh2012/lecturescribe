import unittest
from unittest.mock import MagicMock, patch

from backend.rag_engine import Llama3PineconeRAGStore


CUES = [{"time": f"00:{i:02d}", "text": f"cue number {i} about edit distance"} for i in range(20)]


def _fresh_engine() -> Llama3PineconeRAGStore:
    engine = Llama3PineconeRAGStore.__new__(Llama3PineconeRAGStore)
    engine.video_id = ""
    engine.video_title = ""
    engine.local_chunks = []
    engine.namespace = "ns"
    engine.index = MagicMock()
    return engine


class TestIngestUpsertFlag(unittest.TestCase):
    def test_default_upserts_to_pinecone(self):
        engine = _fresh_engine()
        count = engine.ingest_transcript("vid1", "T", CUES)
        self.assertGreater(count, 0)
        engine.index.upsert.assert_called()

    def test_upsert_false_hydrates_local_chunks_without_network(self):
        engine = _fresh_engine()
        count = engine.ingest_transcript("vid1", "T", CUES, upsert=False)
        self.assertGreater(count, 0)
        self.assertEqual(len(engine.local_chunks), count)
        engine.index.upsert.assert_not_called()

    def test_hydrate_and_import_produce_identical_chunks(self):
        a, b = _fresh_engine(), _fresh_engine()
        a.ingest_transcript("vid1", "T", CUES)
        b.ingest_transcript("vid1", "T", CUES, upsert=False)
        self.assertEqual(a.local_chunks, b.local_chunks)


class TestProcessChatMessageDoesNotReindex(unittest.TestCase):
    def test_hydrates_without_upsert_or_algolia(self):
        import backend.main as main

        engine = MagicMock()
        engine.local_chunks = []
        engine.query_rag.return_value = {"answer": "", "citations": []}
        with patch.object(main, "pinecone_rag_engine", engine), \
             patch.object(main, "algolia_service") as algolia, \
             patch.object(main, "redis_cache", None):
            main.process_chat_message(
                user_prompt="hello", video_id="vid1", video_title="T",
                cues=CUES, save_to_db=False, bypass_cache=True,
            )
        engine.ingest_transcript.assert_called_once_with("vid1", "T", CUES, upsert=False)
        algolia.ingest_cues.assert_not_called()


if __name__ == "__main__":
    unittest.main()

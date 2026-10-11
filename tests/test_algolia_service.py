import unittest
from unittest.mock import MagicMock
from backend.algolia_service import AlgoliaSearchService, generate_dual_representation


class TestAlgoliaFootprintOptimization(unittest.TestCase):

    def setUp(self):
        self.service = AlgoliaSearchService()
        self.service.client = MagicMock()
        self.service.index_name = "test_index"

    def test_build_transcript_chunks_reduces_record_count(self):
        """Windowed chunking should aggregate fine-grained cues into ~30s blocks, achieving 80-90% footprint reduction."""
        # Simulate 100 cues spaced 3 seconds apart (total 300 seconds / 5 minutes)
        fake_cues = []
        for i in range(100):
            sec = i * 3
            mins = sec // 60
            secs = sec % 60
            fake_cues.append({
                "id": 1000 + i,
                "time": f"{mins:02d}:{secs:02d}",
                "seconds": sec,
                "text": f"Word{i} is spoken here."
            })

        chunks = self.service.build_transcript_chunks("test_vid_1", "Test Lecture", fake_cues, window_seconds=30)

        # 300 seconds / 30 seconds window = ~10-11 chunks instead of 100 records
        self.assertLessEqual(len(chunks), 12)
        self.assertGreaterEqual(len(chunks), 9)

        # Verify chunk structure
        first_chunk = chunks[0]
        self.assertEqual(first_chunk["objectID"], "vimeo-test_vid_1-chunk-0")
        self.assertEqual(first_chunk["video_id"], "test_vid_1")
        self.assertEqual(first_chunk["timestamp"], "00:00")
        self.assertEqual(first_chunk["seconds"], 0)
        self.assertIn("Word0", first_chunk["text"])
        self.assertIn("Word9", first_chunk["text"])
        self.assertIn(1000, first_chunk["cue_ids"])
        self.assertIn(0, first_chunk["cue_indices"])

    def test_ingest_cues_pushes_chunks_not_individual_cues(self):
        """Full ingest should call save_objects with chunked records rather than 1 record per cue."""
        cues = [
            {"id": 1, "time": "00:00", "seconds": 0, "text": "First sentence."},
            {"id": 2, "time": "00:05", "seconds": 5, "text": "Second sentence."},
            {"id": 3, "time": "00:10", "seconds": 10, "text": "Third sentence."},
        ]

        count = self.service.ingest_cues("vid_99", "Lecture 99", cues, window_seconds=30)
        self.assertEqual(count, 1)  # All fits in one 30s chunk
        self.service.client.save_objects.assert_called_once()
        saved_objects = self.service.client.save_objects.call_args.kwargs["objects"]
        self.assertEqual(len(saved_objects), 1)
        self.assertEqual(saved_objects[0]["objectID"], "vimeo-vid_99-chunk-0")
        self.assertIn("First sentence. Second sentence. Third sentence.", saved_objects[0]["text"])

    def test_single_cue_update_saves_only_affected_chunk(self):
        """Editing a single cue should target only the affected chunk (1 write op) instead of all objects."""
        cues = [
            {"id": 1, "time": "00:00", "seconds": 0, "text": "Beginning intro."},
            {"id": 2, "time": "00:35", "seconds": 35, "text": "Second chunk start."},
            {"id": 3, "time": "00:40", "seconds": 40, "text": "Target cue with typo."}
        ]

        # Update cue with id 3
        count = self.service.ingest_cues("vid_99", "Lecture 99", cues, updated_cue_id=3, window_seconds=30)
        self.assertEqual(count, 1)

        # save_objects should NOT be called (no full re-index)
        self.service.client.save_objects.assert_not_called()

        # save_object should be called EXACTLY once with the matching chunk
        self.service.client.save_object.assert_called_once()
        saved_body = self.service.client.save_object.call_args.kwargs["body"]
        self.assertEqual(saved_body["objectID"], "vimeo-vid_99-chunk-1")
        self.assertIn("Target cue with typo.", saved_body["text"])
        self.assertIn(3, saved_body["cue_ids"])

    def test_update_single_cue_convenience_method(self):
        """update_single_cue helper delegates to targeted single chunk update."""
        cues = [
            {"id": 1, "time": "00:00", "seconds": 0, "text": "Intro."},
            {"id": 2, "time": "00:35", "seconds": 35, "text": "Chunk 2."}
        ]
        success = self.service.update_single_cue("vid_10", "Lecture 10", cues, cue_id=2, window_seconds=30)
        self.assertTrue(success)
        self.service.client.save_object.assert_called_once()
        self.service.client.save_objects.assert_not_called()

    def test_delete_video_records_calls_delete_by(self):
        """delete_video_records purges all objects matching video_id filter."""
        res = self.service.delete_video_records("vid_delete_123")
        self.assertTrue(res)
        self.service.client.delete_by.assert_called_once_with(
            index_name="test_index",
            delete_by_params={"filters": "video_id:vid_delete_123"}
        )

    def test_reindex_video_purges_and_reingests(self):
        """reindex_video purges legacy records and saves new chunks."""
        cues = [
            {"id": 1, "time": "00:00", "seconds": 0, "text": "Reindexed chunk 1."},
            {"id": 2, "time": "00:40", "seconds": 40, "text": "Reindexed chunk 2."}
        ]
        count = self.service.reindex_video("vid_reindex_456", "Lecture Title", cues, window_seconds=30)
        self.assertEqual(count, 2)
        self.service.client.delete_by.assert_called_once()
        self.service.client.save_objects.assert_called_once()

    def test_reindex_script_run_reindex_dry_run_and_live(self):
        """scripts/reindex_algolia_chunks.py run_reindex processes database videos correctly."""
        from unittest.mock import patch
        from scripts.reindex_algolia_chunks import run_reindex

        fake_videos = [
            {
                "video_id": "vid_abc",
                "title": "Machine Learning",
                "cues": [
                    {"id": 1, "time": "00:00", "seconds": 0, "text": "Hello world."},
                    {"id": 2, "time": "00:05", "seconds": 5, "text": "Part two."}
                ]
            }
        ]

        with patch("scripts.reindex_algolia_chunks.fetch_videos_with_cues", return_value=fake_videos), \
             patch("scripts.reindex_algolia_chunks.algolia_service.delete_video_records") as mock_del, \
             patch("scripts.reindex_algolia_chunks.algolia_service.ingest_cues", return_value=1) as mock_ingest:

            # 1. Dry run: should NOT call delete or ingest
            run_reindex(target_video_id="vid_abc", dry_run=True)
            mock_del.assert_not_called()
            mock_ingest.assert_not_called()

            # 2. Live run: should call delete and ingest
            run_reindex(target_video_id="vid_abc", dry_run=False)
            mock_del.assert_called_once_with("vid_abc")
            mock_ingest.assert_called_once()


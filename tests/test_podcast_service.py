import unittest
from unittest.mock import patch, MagicMock
from backend.podcast_service import (
    slm_write_podcast_script,
    slm_polish_speech_for_tts,
    generate_podcast_script_2layer,
    chunk_text_by_sentences,
)


class TestPodcastService(unittest.TestCase):
    @patch("backend.podcast_service._call_slm")
    def test_slm_write_podcast_script_study_mode(self, mock_slm):
        mock_slm.return_value = "Welcome back students. Today we explore eigenvalues."
        title = "Linear Algebra Lecture 5"
        text = "Key concepts: matrices, eigenvalues, eigenvectors."

        result = slm_write_podcast_script(title, text, mode="study")

        self.assertEqual(result, "Welcome back students. Today we explore eigenvalues.")
        mock_slm.assert_called_once()
        prompt_arg = mock_slm.call_args[0][0]

        # Verify study mode prompt characteristics
        self.assertIn("expert academic tutor", prompt_arg)
        self.assertIn("COMPREHENSIVE STUDY NOTES:", prompt_arg)
        self.assertIn("Complete Coverage", prompt_arg)
        self.assertIn("exam recall checkpoints", prompt_arg)
        self.assertNotIn("STUDENT ASSIGNMENT SUBMISSION PROSE:", prompt_arg)

    @patch("backend.podcast_service._call_slm")
    def test_slm_write_podcast_script_submission_mode(self, mock_slm):
        mock_slm.return_value = "In this assignment presentation, I analyze matrix spectral decomposition."
        title = "Linear Algebra Assignment"
        text = "Assignment submission discussing symmetric matrices and PCA."

        result = slm_write_podcast_script(title, text, mode="submission")

        self.assertEqual(result, "In this assignment presentation, I analyze matrix spectral decomposition.")
        mock_slm.assert_called_once()
        prompt_arg = mock_slm.call_args[0][0]

        # Verify submission mode prompt characteristics
        self.assertIn("accomplished university graduate student", prompt_arg)
        self.assertIn("STUDENT ASSIGNMENT SUBMISSION PROSE:", prompt_arg)
        self.assertIn("First-Person Scholarly Perspective", prompt_arg)
        self.assertIn("NO Informal Podcast Banter", prompt_arg)
        self.assertNotIn("COMPREHENSIVE STUDY NOTES:", prompt_arg)

    @patch("backend.podcast_service._call_slm")
    def test_slm_polish_speech_for_tts(self, mock_slm):
        mock_slm.return_value = "Let us calculate x squared."
        draft = "Let's calculate $x^2$."

        result = slm_polish_speech_for_tts(draft)

        self.assertEqual(result, "Let us calculate x squared.")
        mock_slm.assert_called_once()
        prompt_arg = mock_slm.call_args[0][0]
        self.assertIn("phonetic speech specialist", prompt_arg)
        self.assertIn("Phonetically expand any abbreviations", prompt_arg)

    @patch("backend.podcast_service.slm_polish_speech_for_tts")
    @patch("backend.podcast_service.slm_write_podcast_script")
    def test_generate_podcast_script_2layer_propagates_mode(self, mock_writer, mock_director):
        mock_writer.return_value = "Draft comprehensive review."
        mock_director.return_value = "Polished spoken review."

        # Study mode uses writer + polish
        result_study = generate_podcast_script_2layer("Title", "Comprehensive study guide", mode="study")
        self.assertEqual(result_study, "Polished spoken review.")
        mock_writer.assert_called_once_with("Title", "Comprehensive study guide", "study")
        mock_director.assert_called_with("Draft comprehensive review.")

        # Submission mode polishes submission text directly for exact length fidelity
        mock_director.return_value = "Polished submission essay."
        result_sub = generate_podcast_script_2layer("Title", "Assignment writeup content", mode="submission")
        self.assertEqual(result_sub, "Polished submission essay.")
        mock_director.assert_called_with("Assignment writeup content")

    def test_generate_podcast_script_2layer_empty_text_raises_error(self):
        with self.assertRaises(ValueError):
            generate_podcast_script_2layer("Title", "   ", mode="study")

    def test_chunk_text_by_sentences(self):
        text = "First sentence here. Second sentence follows. Third sentence ends."
        chunks = chunk_text_by_sentences(text, max_chars=30)
        self.assertTrue(len(chunks) >= 2)
        recombined = " ".join(chunks)
        self.assertIn("First sentence here.", recombined)
        self.assertIn("Third sentence ends.", recombined)


if __name__ == "__main__":
    unittest.main()


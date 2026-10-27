import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  TextField,
  CircularProgress,
  IconButton,
  Checkbox,
  Tooltip
} from '@mui/material';
import {
  Database,
  Sparkles,
  Plus,
  Trash2,
  Send,
  CheckCircle2,
  RefreshCw,
  Filter
} from 'lucide-react';

export default function CourseQuestionBank({
  courseName,
  lectures = [],
  isTutor = false,
  userEmail = '',
  onQuizPublished,
  currentTheme
}) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Taxonomy filters
  const [filterDifficulty, setFilterDifficulty] = useState('all');
  const [filterBloom, setFilterBloom] = useState('all');

  // Selected question IDs for Custom Quiz Assembly
  const [selectedIds, setSelectedIds] = useState([]);
  const [customQuizTitle, setCustomQuizTitle] = useState('');

  // AI Question Generator inputs
  const [genLectureId, setGenLectureId] = useState('');
  const [genDifficulty, setGenDifficulty] = useState('medium');
  const [genBloom, setGenBloom] = useState('apply');
  const [genCount, setGenCount] = useState(3);

  // Manual Question Authoring form
  const [showAddModal, setShowAddModal] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newOptionsText, setNewOptionsText] = useState('Option A\nOption B\nOption C\nOption D');
  const [newCorrectIndex, setNewCorrectIndex] = useState('0');
  const [newExplanation, setNewExplanation] = useState('');
  const [newDifficulty, setNewDifficulty] = useState('medium');
  const [newBloom, setNewBloom] = useState('apply');

  const fetchBank = useCallback(async () => {
    if (!courseName) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filterDifficulty !== 'all') params.set('difficulty', filterDifficulty);
      if (filterBloom !== 'all') params.set('bloom_level', filterBloom);
      const res = await fetch(
        `/api/course/${encodeURIComponent(courseName)}/question-bank?${params.toString()}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to load Question Bank');
      setQuestions(data.questions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [courseName, filterDifficulty, filterBloom]);

  useEffect(() => {
    fetchBank();
  }, [fetchBank]);

  const handleAiGenerate = async () => {
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const selectedLec = lectures.find((l) => (l.video_id || l.videoId) === genLectureId);
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/question-bank/ai-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: genLectureId || undefined,
          lecture_title: selectedLec?.title || courseName,
          count: Number(genCount) || 3,
          difficulty: genDifficulty,
          bloom_level: genBloom,
          actor_email: userEmail || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'AI generation failed');
      setNotice(`Generated ${data.generated_count || (data.questions || []).length} Bloom-tagged questions into the bank!`);
      fetchBank();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveManualQuestion = async (e) => {
    e.preventDefault();
    if (!newQuestionText.trim()) return;
    setError('');
    try {
      const opts = newOptionsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/question-bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_email: userEmail || undefined,
          items: [
            {
              question_text: newQuestionText.trim(),
              options: opts.length >= 2 ? opts : ['True', 'False'],
              correct_answer: newCorrectIndex,
              explanation: newExplanation.trim(),
              difficulty: newDifficulty,
              bloom_level: newBloom,
              lecture_title: courseName
            }
          ]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to save question');
      setNewQuestionText('');
      setNewExplanation('');
      setShowAddModal(false);
      setNotice('Saved custom question to the Course Question Bank.');
      fetchBank();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteQuestion = async (questionId) => {
    try {
      const res = await fetch(
        `/api/course/${encodeURIComponent(courseName)}/question-bank/${encodeURIComponent(questionId)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        setQuestions((prev) => prev.filter((q) => q.question_id !== questionId));
        setSelectedIds((prev) => prev.filter((id) => id !== questionId));
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePublishQuiz = async () => {
    setPublishing(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/course/${encodeURIComponent(courseName)}/question-bank/publish-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_ids: selectedIds.length > 0 ? selectedIds : undefined,
          title: customQuizTitle.trim() || `${courseName} Custom Question Bank Exam`,
          actor_email: userEmail || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to publish custom quiz');
      const qCount = data.quiz?.questions?.length || 0;
      setNotice(`Published Custom Exam (${qCount} questions) to Course Quiz!`);
      if (onQuizPublished) {
        onQuizPublished(data.quiz);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const toggleSelectQuestion = (qid) => {
    setSelectedIds((prev) => (prev.includes(qid) ? prev.filter((id) => id !== qid) : [...prev, qid]));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header & AI Question Bank Controls */}
      <Box
        sx={{
          p: 3,
          borderRadius: 3,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          boxShadow: currentTheme.palette.cardShadow
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Database size={22} color={currentTheme.palette.primary} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
                AI Question Bank & Custom Quiz Builder
              </Typography>
              <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
                Curate reusable questions tagged by Bloom&apos;s Taxonomy & Difficulty, then publish custom exams to Course Quiz
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Plus size={15} />}
              onClick={() => setShowAddModal((v) => !v)}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
            >
              Add Custom Question
            </Button>
            <Button
              variant="contained"
              size="small"
              disabled={publishing || questions.length === 0}
              startIcon={publishing ? <CircularProgress size={14} color="inherit" /> : <Send size={15} />}
              onClick={handlePublishQuiz}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: 2,
                bgcolor: '#10b981',
                color: '#fff'
              }}
            >
              Publish to Course Quiz ({selectedIds.length > 0 ? selectedIds.length : questions.length})
            </Button>
            <IconButton size="small" onClick={fetchBank} aria-label="Refresh Question Bank">
              <RefreshCw size={16} color={currentTheme.palette.textSecondary} />
            </IconButton>
          </Box>
        </Box>

        {/* AI Question Generator Strip */}
        <Box
          sx={{
            mt: 2.5,
            p: 2,
            borderRadius: 2.5,
            bgcolor: 'rgba(99, 102, 241, 0.06)',
            border: `1px solid ${currentTheme.palette.cardBorder}`,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1.5
          }}
        >
          <TextField
            select
            size="small"
            label="Source Lecture"
            value={genLectureId}
            onChange={(e) => setGenLectureId(e.target.value)}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            sx={{ minWidth: 190 }}
          >
            <option value="">All Course Topics</option>
            {lectures.map((lec) => {
              const vid = lec.video_id || lec.videoId;
              return (
                <option key={vid} value={vid}>
                  {lec.title || vid}
                </option>
              );
            })}
          </TextField>

          <TextField
            select
            size="small"
            label="Difficulty"
            value={genDifficulty}
            onChange={(e) => setGenDifficulty(e.target.value)}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            sx={{ minWidth: 120 }}
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </TextField>

          <TextField
            select
            size="small"
            label="Bloom Level"
            value={genBloom}
            onChange={(e) => setGenBloom(e.target.value)}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            sx={{ minWidth: 135 }}
          >
            <option value="remember">Remember</option>
            <option value="understand">Understand</option>
            <option value="apply">Apply</option>
            <option value="analyze">Analyze</option>
            <option value="evaluate">Evaluate</option>
          </TextField>

          <TextField
            size="small"
            type="number"
            label="Count"
            value={genCount}
            onChange={(e) => setGenCount(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: 85 }}
          />

          <Button
            variant="contained"
            size="small"
            disabled={generating}
            startIcon={generating ? <CircularProgress size={14} color="inherit" /> : <Sparkles size={15} />}
            onClick={handleAiGenerate}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              bgcolor: currentTheme.palette.primary,
              color: '#fff'
            }}
          >
            AI Generate Questions
          </Button>
        </Box>

        {/* Filter Bar */}
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Filter size={15} color={currentTheme.palette.textSecondary} />
          <Typography variant="caption" sx={{ fontWeight: 700, color: currentTheme.palette.textSecondary }}>
            Filter Bank:
          </Typography>
          {['all', 'easy', 'medium', 'hard'].map((diff) => (
            <Chip
              key={diff}
              label={`Difficulty: ${diff}`}
              size="small"
              onClick={() => setFilterDifficulty(diff)}
              sx={{
                cursor: 'pointer',
                fontWeight: 700,
                bgcolor: filterDifficulty === diff ? currentTheme.palette.primary : currentTheme.palette.badgeBg,
                color: filterDifficulty === diff ? '#fff' : currentTheme.palette.textPrimary
              }}
            />
          ))}
          <TextField
            size="small"
            placeholder="Custom Exam Title (optional)"
            value={customQuizTitle}
            onChange={(e) => setCustomQuizTitle(e.target.value)}
            sx={{ ml: 'auto', minWidth: 230 }}
          />
        </Box>

        {notice && (
          <Typography variant="body2" sx={{ mt: 1.5, color: '#10b981', fontWeight: 600 }}>
            {notice}
          </Typography>
        )}
        {error && (
          <Typography variant="body2" sx={{ mt: 1.5, color: '#ef4444', fontWeight: 600 }}>
            {error}
          </Typography>
        )}
      </Box>

      {/* Manual Question Form */}
      {showAddModal && (
        <Box
          component="form"
          onSubmit={handleSaveManualQuestion}
          sx={{
            p: 2.5,
            borderRadius: 3,
            bgcolor: currentTheme.palette.cardBg,
            border: `1px solid ${currentTheme.palette.primary}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
            Author Custom Question for Bank
          </Typography>
          <TextField
            size="small"
            label="Question Stem"
            value={newQuestionText}
            onChange={(e) => setNewQuestionText(e.target.value)}
            required
            fullWidth
          />
          <TextField
            size="small"
            label="Options (one per line)"
            value={newOptionsText}
            onChange={(e) => setNewOptionsText(e.target.value)}
            multiline
            rows={3}
            fullWidth
          />
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              label="Correct Option Index (0-based)"
              value={newCorrectIndex}
              onChange={(e) => setNewCorrectIndex(e.target.value)}
              sx={{ width: 200 }}
            />
            <TextField
              select
              size="small"
              label="Difficulty"
              value={newDifficulty}
              onChange={(e) => setNewDifficulty(e.target.value)}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </TextField>
            <TextField
              select
              size="small"
              label="Bloom Level"
              value={newBloom}
              onChange={(e) => setNewBloom(e.target.value)}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            >
              <option value="remember">Remember</option>
              <option value="understand">Understand</option>
              <option value="apply">Apply</option>
              <option value="analyze">Analyze</option>
              <option value="evaluate">Evaluate</option>
            </TextField>
          </Box>
          <TextField
            size="small"
            label="Solution Explanation"
            value={newExplanation}
            onChange={(e) => setNewExplanation(e.target.value)}
            fullWidth
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button size="small" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" size="small" sx={{ fontWeight: 700 }}>
              Save Question
            </Button>
          </Box>
        </Box>
      )}

      {/* Question Bank List */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : questions.length === 0 ? (
        <Box
          sx={{
            p: 4,
            textAlign: 'center',
            borderRadius: 3,
            bgcolor: currentTheme.palette.cardBg,
            border: `1px solid ${currentTheme.palette.cardBorder}`
          }}
        >
          <Typography variant="body1" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
            No questions in the bank yet.
          </Typography>
          <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
            Click &ldquo;AI Generate Questions&rdquo; above to populate Bloom-tagged questions from course lectures.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {questions.map((q) => {
            const isSelected = selectedIds.includes(q.question_id);
            const correctIdx = Number(q.correct_answer || 0);
            return (
              <Box
                key={q.question_id}
                sx={{
                  p: 2.2,
                  borderRadius: 2.5,
                  bgcolor: currentTheme.palette.cardBg,
                  border: `1px solid ${isSelected ? currentTheme.palette.primary : currentTheme.palette.cardBorder}`,
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 1.5
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.2, flex: 1 }}>
                  <Checkbox
                    size="small"
                    checked={isSelected}
                    onChange={() => toggleSelectQuestion(q.question_id)}
                    inputProps={{ 'aria-label': `Select question ${q.question_id}` }}
                  />
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 0.8 }}>
                      <Chip
                        label={`Bloom: ${(q.bloom_level || 'apply').toUpperCase()}`}
                        size="small"
                        sx={{ fontWeight: 700, fontSize: '0.7rem', bgcolor: 'rgba(139, 92, 246, 0.14)', color: '#8b5cf6' }}
                      />
                      <Chip
                        label={`Difficulty: ${(q.difficulty || 'medium').toUpperCase()}`}
                        size="small"
                        sx={{ fontWeight: 700, fontSize: '0.7rem', bgcolor: 'rgba(245, 158, 11, 0.14)', color: '#f59e0b' }}
                      />
                      {q.lecture_title && (
                        <Chip
                          label={`${q.lecture_title}${q.timestamp_str ? ` @ ${q.timestamp_str}` : ''}`}
                          size="small"
                          sx={{ fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>

                    <Typography variant="body1" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary, mb: 1 }}>
                      {q.question_text}
                    </Typography>

                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0.8 }}>
                      {(q.options || []).map((opt, idx) => (
                        <Box
                          key={idx}
                          sx={{
                            p: 1,
                            borderRadius: 1.5,
                            fontSize: '0.82rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.8,
                            bgcolor: idx === correctIdx ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                            border: `1px solid ${idx === correctIdx ? '#10b981' : currentTheme.palette.cardBorder}`,
                            color: currentTheme.palette.textPrimary,
                            fontWeight: idx === correctIdx ? 700 : 500
                          }}
                        >
                          {idx === correctIdx && <CheckCircle2 size={14} color="#10b981" />}
                          <span>{opt}</span>
                        </Box>
                      ))}
                    </Box>

                    {q.explanation && (
                      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: currentTheme.palette.textSecondary }}>
                        💡 {q.explanation}
                      </Typography>
                    )}
                  </Box>
                </Box>

                <Tooltip title="Delete Question">
                  <IconButton size="small" onClick={() => handleDeleteQuestion(q.question_id)}>
                    <Trash2 size={15} color="#ef4444" />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}


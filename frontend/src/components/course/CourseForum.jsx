import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Chip,
  CircularProgress,
  TextField,
  Divider,
  Select,
  MenuItem,
  Alert
} from '@mui/material';
import {
  MessageSquare,
  Sparkles,
  CheckCircle2,
  PlayCircle,
  Send,
  ThumbsUp,
  Pin,
  Plus
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { normalizeCourseSlug } from '../../utils/routing';

export default function CourseForum({
  courseName = 'Active Course',
  lectures = [],
  isTutor = false,
  userEmail = '',
  userName = '',
  onJumpToLecture,
  currentTheme
}) {
  const courseSlug = normalizeCourseSlug(courseName);
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');

  // New Thread Composer State
  const [showNewThreadForm, setShowNewThreadForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('lecture_question');
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [timestampStr, setTimestampStr] = useState('');
  const [postingThread, setPostingThread] = useState(false);

  // Reply & AI TA state
  const [replyDrafts, setReplyDrafts] = useState({});
  const [postingReplyId, setPostingReplyId] = useState(null);
  const [aiDraftingId, setAiDraftingId] = useState(null);

  const palette = currentTheme?.palette || {
    primary: '#3b82f6',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    textPrimary: '#0f172a',
    textSecondary: '#64748b'
  };

  const fetchThreads = useCallback(async () => {
    if (!courseSlug) return;
    setLoading(true);
    try {
      const catQuery = categoryFilter && categoryFilter !== 'all' ? `?category=${encodeURIComponent(categoryFilter)}` : '';
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/forum${catQuery}`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads || []);
      }
    } catch (e) {
      console.error('[CourseForum] fetchThreads error:', e);
    } finally {
      setLoading(false);
    }
  }, [courseSlug, categoryFilter]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  const handleCreateThread = async () => {
    if (!title.trim() || !body.trim()) return;
    setPostingThread(true);
    try {
      const matchedLec = lectures.find((l) => String(l.video_id || l.videoId) === String(selectedVideoId));
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/forum`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          category,
          author_email: userEmail || 'student@iiitdwd.ac.in',
          author_name: userName || (userEmail ? userEmail.split('@')[0] : 'Student'),
          author_role: isTutor ? 'tutor' : 'student',
          video_id: selectedVideoId || '',
          lecture_title: matchedLec?.title || '',
          timestamp_str: timestampStr.trim()
        })
      });
      if (res.ok) {
        setTitle('');
        setBody('');
        setSelectedVideoId('');
        setTimestampStr('');
        setShowNewThreadForm(false);
        await fetchThreads();
      }
    } catch (e) {
      console.error('Create forum thread error:', e);
    } finally {
      setPostingThread(false);
    }
  };

  const handlePostReply = async (threadId) => {
    const text = (replyDrafts[threadId] || '').trim();
    if (!text) return;
    setPostingReplyId(threadId);
    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/forum/${encodeURIComponent(threadId)}/reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            author_email: userEmail || 'student@iiitdwd.ac.in',
            author_name: userName || (userEmail ? userEmail.split('@')[0] : 'Student'),
            author_role: isTutor ? 'tutor' : 'student',
            body: text
          })
        }
      );
      if (res.ok) {
        setReplyDrafts((prev) => ({ ...prev, [threadId]: '' }));
        await fetchThreads();
      }
    } catch (e) {
      console.error('Post reply error:', e);
    } finally {
      setPostingReplyId(null);
    }
  };

  const handleAskAiTa = async (threadId) => {
    setAiDraftingId(threadId);
    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/forum/${encodeURIComponent(threadId)}/ai-reply`,
        { method: 'POST' }
      );
      if (res.ok) {
        await fetchThreads();
      }
    } catch (e) {
      console.error('AI TA reply error:', e);
    } finally {
      setAiDraftingId(null);
    }
  };

  const handleEndorseReply = async (threadId, replyId, currentEndorsed) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/forum/${encodeURIComponent(threadId)}/endorse/${encodeURIComponent(replyId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            is_endorsed: !currentEndorsed,
            resolve_thread: !currentEndorsed,
            actor_email: userEmail || undefined
          })
        }
      );
      if (res.ok) {
        await fetchThreads();
      }
    } catch (e) {
      console.error('Endorse reply error:', e);
    }
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 1100, mx: 'auto', pb: 8 }}>
      {/* HEADER BANNER */}
      <Paper
        elevation={0}
        sx={{
          p: 3.5,
          mb: 3.5,
          borderRadius: 3,
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(59, 130, 246, 0.06) 100%)',
          border: `1px solid ${palette.cardBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 2
        }}
      >
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Chip
              icon={<MessageSquare size={14} color="#d97706" />}
              label="Course Q&A Forum • Timestamp Deep-Links & AI TA"
              size="small"
              sx={{ bgcolor: 'rgba(245, 158, 11, 0.14)', color: '#b45309', fontWeight: 700 }}
            />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: palette.textPrimary }}>
            {courseName} • Discussions & Q&A Forum
          </Typography>
          <Typography variant="body2" sx={{ color: palette.textSecondary, mt: 0.5 }}>
            Ask questions linked to exact lecture timestamps, collaborate with classmates, or summon the Course-RAG AI Teaching Assistant.
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={() => setShowNewThreadForm((prev) => !prev)}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, bgcolor: palette.primary }}
        >
          {showNewThreadForm ? 'Close Composer' : 'New Discussion Thread'}
        </Button>
      </Paper>

      {/* NEW THREAD COMPOSER */}
      {showNewThreadForm && (
        <Paper
          elevation={0}
          sx={{
            p: 3,
            mb: 3.5,
            borderRadius: 3,
            border: `1px solid ${palette.primary}`,
            bgcolor: palette.cardBg
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>
            Start a New Course Question or Discussion
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                label="Question / Topic Title"
                placeholder="e.g. Intuition behind Fisher Information regularity condition?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                sx={{ flex: 1, minWidth: 260 }}
              />
              <Select
                size="small"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                sx={{ minWidth: 170 }}
              >
                <MenuItem value="lecture_question">Lecture Question</MenuItem>
                <MenuItem value="assignment">Assignment Help</MenuItem>
                <MenuItem value="exam">Exam Prep</MenuItem>
                <MenuItem value="general">General Discussion</MenuItem>
              </Select>
            </Box>

            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <Select
                size="small"
                displayEmpty
                value={selectedVideoId}
                onChange={(e) => setSelectedVideoId(e.target.value)}
                sx={{ flex: 1, minWidth: 220 }}
              >
                <MenuItem value="">
                  <em>Optional: Link to a Course Lecture</em>
                </MenuItem>
                {lectures.map((lec) => {
                  const vid = lec.video_id || lec.videoId;
                  return (
                    <MenuItem key={vid} value={vid}>
                      {lec.title || `Lecture ${vid}`}
                    </MenuItem>
                  );
                })}
              </Select>
              <TextField
                size="small"
                label="Timestamp (MM:SS)"
                placeholder="e.g. 14:20"
                value={timestampStr}
                onChange={(e) => setTimestampStr(e.target.value)}
                sx={{ width: 165 }}
              />
            </Box>

            <TextField
              multiline
              minRows={3}
              size="small"
              label="Question Details"
              placeholder="Describe your question clearly. You can reference formulas, slides, or timestamps like [14:20]..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
              <Button
                variant="text"
                onClick={() => setShowNewThreadForm(false)}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                disabled={postingThread || !title.trim() || !body.trim()}
                onClick={handleCreateThread}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
              >
                {postingThread ? 'Posting...' : 'Post Question'}
              </Button>
            </Box>
          </Box>
        </Paper>
      )}

      {/* CATEGORY FILTER PILLS */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
        {[
          { id: 'all', label: 'All Discussions' },
          { id: 'lecture_question', label: 'Lecture Questions' },
          { id: 'assignment', label: 'Assignments' },
          { id: 'exam', label: 'Exam Prep' },
          { id: 'general', label: 'General' }
        ].map((cat) => (
          <Chip
            key={cat.id}
            label={cat.label}
            clickable
            onClick={() => setCategoryFilter(cat.id)}
            sx={{
              fontWeight: 700,
              bgcolor: categoryFilter === cat.id ? palette.primary : palette.cardBg,
              color: categoryFilter === cat.id ? '#ffffff' : palette.textSecondary,
              border: `1px solid ${categoryFilter === cat.id ? palette.primary : palette.cardBorder}`
            }}
          />
        ))}
      </Box>

      {/* THREADS LIST */}
      {loading ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : threads.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            p: 6,
            textAlign: 'center',
            borderRadius: 3,
            border: `1px dashed ${palette.cardBorder}`,
            bgcolor: palette.cardBg
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: palette.textPrimary, mb: 0.5 }}>
            No discussion threads yet
          </Typography>
          <Typography variant="body2" sx={{ color: palette.textSecondary, mb: 2.5 }}>
            Be the first to ask a question about a lecture timestamp or assignment problem!
          </Typography>
          <Button
            variant="outlined"
            startIcon={<Plus size={16} />}
            onClick={() => setShowNewThreadForm(true)}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
          >
            Ask First Question
          </Button>
        </Paper>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {threads.map((thr) => (
            <Paper
              key={thr.thread_id}
              elevation={0}
              sx={{
                p: 3,
                borderRadius: 3,
                border: `1px solid ${palette.cardBorder}`,
                bgcolor: palette.cardBg
              }}
            >
              {/* Thread Header */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.6 }}>
                    {thr.is_pinned && (
                      <Chip icon={<Pin size={12} />} label="Pinned" size="small" sx={{ fontWeight: 700 }} />
                    )}
                    {thr.is_resolved && (
                      <Chip
                        icon={<CheckCircle2 size={13} color="#047857" />}
                        label="Resolved"
                        size="small"
                        sx={{ bgcolor: '#ecfdf5', color: '#047857', fontWeight: 700 }}
                      />
                    )}
                    <Chip
                      label={thr.category?.replace('_', ' ') || 'general'}
                      size="small"
                      sx={{ textTransform: 'capitalize', fontWeight: 600 }}
                    />
                    {(thr.video_id || thr.timestamp_str) && (
                      <Chip
                        icon={<PlayCircle size={13} color="#2563eb" />}
                        label={`${thr.lecture_title || 'Lecture'}${thr.timestamp_str ? ` @ ${thr.timestamp_str}` : ''}`}
                        clickable={!!(thr.video_id && onJumpToLecture)}
                        onClick={() => {
                          if (thr.video_id && onJumpToLecture) {
                            onJumpToLecture(thr.video_id, thr.timestamp_str || '00:00');
                          }
                        }}
                        size="small"
                        sx={{
                          bgcolor: '#eff6ff',
                          color: '#1d4ed8',
                          fontWeight: 700
                        }}
                      />
                    )}
                  </Box>
                  <Typography variant="h6" sx={{ fontWeight: 800, color: palette.textPrimary, fontSize: '1.05rem' }}>
                    {thr.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: palette.textSecondary }}>
                    Posted by <strong>{thr.author_name || thr.author_email}</strong> ({thr.author_role}) •{' '}
                    {new Date(thr.created_at || Date.now()).toLocaleString()}
                  </Typography>
                </Box>

                <Button
                  variant="outlined"
                  size="small"
                  disabled={aiDraftingId === thr.thread_id}
                  startIcon={<Sparkles size={14} />}
                  onClick={() => handleAskAiTa(thr.thread_id)}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
                >
                  {aiDraftingId === thr.thread_id ? 'AI TA Thinking...' : 'Ask AI TA'}
                </Button>
              </Box>

              <Typography variant="body2" sx={{ color: palette.textPrimary, my: 1.5, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {thr.body}
              </Typography>

              <Divider sx={{ my: 2 }} />

              {/* Replies List */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
                {(thr.replies || []).map((rep) => (
                  <Box
                    key={rep.reply_id}
                    sx={{
                      p: 2,
                      borderRadius: 2,
                      bgcolor: rep.is_ai_generated
                        ? 'rgba(59, 130, 246, 0.04)'
                        : rep.is_instructor_endorsed
                        ? 'rgba(16, 185, 129, 0.04)'
                        : 'rgba(0,0,0,0.02)',
                      border: `1px solid ${
                        rep.is_instructor_endorsed
                          ? '#a7f3d0'
                          : rep.is_ai_generated
                          ? '#bfdbfe'
                          : palette.cardBorder
                      }`
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.8, flexWrap: 'wrap', gap: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          {rep.author_name || rep.author_email}
                        </Typography>
                        {rep.is_ai_generated && (
                          <Chip
                            icon={<Sparkles size={12} color="#1d4ed8" />}
                            label="AI TA Grounded Reply"
                            size="small"
                            sx={{ bgcolor: '#dbeafe', color: '#1d4ed8', fontWeight: 700, fontSize: '0.7rem' }}
                          />
                        )}
                        {rep.is_instructor_endorsed && (
                          <Chip
                            icon={<CheckCircle2 size={12} color="#047857" />}
                            label="Instructor Endorsed"
                            size="small"
                            sx={{ bgcolor: '#d1fae5', color: '#047857', fontWeight: 700, fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>

                      {isTutor && (
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<ThumbsUp size={13} />}
                          onClick={() => handleEndorseReply(thr.thread_id, rep.reply_id, rep.is_instructor_endorsed)}
                          sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.75rem' }}
                        >
                          {rep.is_instructor_endorsed ? 'Unendorse' : 'Endorse & Resolve'}
                        </Button>
                      )}
                    </Box>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                      {rep.body}
                    </Typography>
                  </Box>
                ))}
              </Box>

              {/* Inline Reply Composer */}
              <Box sx={{ display: 'flex', gap: 1.2, alignItems: 'center' }}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Write a reply or follow-up..."
                  value={replyDrafts[thr.thread_id] || ''}
                  onChange={(e) =>
                    setReplyDrafts((prev) => ({ ...prev, [thr.thread_id]: e.target.value }))
                  }
                />
                <Button
                  variant="contained"
                  size="small"
                  disabled={postingReplyId === thr.thread_id || !(replyDrafts[thr.thread_id] || '').trim()}
                  startIcon={<Send size={14} />}
                  onClick={() => handlePostReply(thr.thread_id)}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, flexShrink: 0 }}
                >
                  Reply
                </Button>
              </Box>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}


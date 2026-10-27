import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  IconButton,
  Tooltip,
  TextField,
  MenuItem,
  InputAdornment,
  CircularProgress
} from '@mui/material';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Sparkles,
  FileText,
  Mic,
  Plus,
  Download,
  RefreshCw,
  Search,
  Video,
  ExternalLink,
  Trash2,
  AlertTriangle,
  Award,
  BookOpen,
  ArrowLeft,
  LayoutGrid,
  List
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import CalendarAIExtractorModal from '../calendar/CalendarAIExtractorModal';

const CATEGORY_META = {
  exam: { label: 'Exam / Viva', bg: '#fee2e2', color: '#991b1b', border: '#fca5a5', dot: '#ef4444' },
  quiz: { label: 'Quiz / Test', bg: '#f3e8ff', color: '#6b21a8', border: '#d8b4fe', dot: '#a855f7' },
  assignment: { label: 'Assignment Due', bg: '#fef3c7', color: '#92400e', border: '#fde68a', dot: '#f59e0b' },
  lab: { label: 'Lab Session', bg: '#d1fae5', color: '#065f46', border: '#6ee7b7', dot: '#10b981' },
  lecture: { label: 'Lecture', bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd', dot: '#0284c7' },
  schedule: { label: 'Schedule', bg: '#f1f5f9', color: '#334155', border: '#cbd5e1', dot: '#64748b' }
};

const SOURCE_BADGES = {
  pdf_ai: { label: '📄 AI Exam PDF', bg: 'rgba(16,185,129,0.14)', color: '#34d399', border: 'rgba(16,185,129,0.35)' },
  transcript_ai: { label: '🎙️ AI Transcript', bg: 'rgba(168,85,247,0.14)', color: '#c084fc', border: 'rgba(168,85,247,0.35)' },
  moodle_ical: { label: '🎓 Moodle LMS', bg: 'rgba(234,88,12,0.14)', color: '#fb923c', border: 'rgba(234,88,12,0.35)' },
  manual: { label: '✏️ Custom Event', bg: 'rgba(59,130,246,0.14)', color: '#60a5fa', border: 'rgba(59,130,246,0.35)' }
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarView({
  currentTheme,
  googleUser,
  isTutor = false,
  selectedCourse = null,
  courses = [],
  onNavigateBack = null,
  onSelectLecture = null,
  embeddedInCourse = false
}) {
  const [agenda, setAgenda] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'timeline' | 'ai'
  const [courseFilter, setCourseFilter] = useState(selectedCourse || 'all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Month Grid navigation state
  const [currentMonthDate, setCurrentMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDateIso, setSelectedDateIso] = useState(() => new Date().toISOString().slice(0, 10));

  // AI Extractor Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitialTab, setModalInitialTab] = useState('pdf');

  useEffect(() => {
    if (selectedCourse) {
      setCourseFilter(selectedCourse);
    }
  }, [selectedCourse]);

  const p = currentTheme?.palette || {
    cardBg: '#1e293b',
    cardBorder: 'rgba(255,255,255,0.12)',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    primary: '#3b82f6',
    surface: 'rgba(255,255,255,0.03)'
  };

  const fetchCalendarData = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        refresh: String(refresh),
        days: '90'
      });
      if (courseFilter && courseFilter !== 'all') {
        params.set('course', courseFilter);
      }
      if (googleUser?.email) {
        params.set('user_email', googleUser.email);
      }
      const res = await fetch(`${API_BASE}/api/calendar/events?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to load calendar`);
      }
      const data = await res.json();
      setAgenda(data);
    } catch (err) {
      setError(err.message || 'Unable to load calendar events');
    } finally {
      setLoading(false);
    }
  }, [courseFilter, googleUser?.email]);

  useEffect(() => {
    fetchCalendarData(false);
  }, [fetchCalendarData]);

  const handleDeleteEvent = async (eventId) => {
    if (!eventId) return;
    try {
      const res = await fetch(`${API_BASE}/api/calendar/events/${encodeURIComponent(eventId)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchCalendarData(false);
      }
    } catch (e) {
      console.error('Failed to delete event:', e);
    }
  };

  const allEvents = useMemo(() => {
    const raw = agenda?.all_events || [
      ...(agenda?.today?.all || []),
      ...(agenda?.upcoming || [])
    ];
    return raw.filter((ev) => {
      if (categoryFilter !== 'all' && ev.category !== categoryFilter) return false;
      if (sourceFilter !== 'all' && (ev.source_type || 'moodle_ical') !== sourceFilter) return false;
      if (viewMode === 'ai' && !['pdf_ai', 'transcript_ai'].includes(ev.source_type)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${ev.title || ''} ${ev.description || ''} ${ev.location || ''} ${ev.course_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [agenda, categoryFilter, sourceFilter, viewMode, searchQuery]);

  // Map events by YYYY-MM-DD for Month Grid
  const eventsByDate = useMemo(() => {
    const map = {};
    allEvents.forEach((ev) => {
      const dIso = ev.date_iso || (ev.start ? ev.start.slice(0, 10) : '');
      if (!dIso) return;
      if (!map[dIso]) map[dIso] = [];
      map[dIso].push(ev);
    });
    return map;
  }, [allEvents]);

  // Build 42-cell (6-week) calendar grid for currentMonthDate
  const calendarCells = useMemo(() => {
    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const cells = [];
    const pad2 = (n) => String(n).padStart(2, '0');

    // Leading days from previous month
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const dt = new Date(year, month - 1, d);
      const iso = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
      cells.push({ dateObj: dt, dayNumber: d, dateIso: iso, isCurrentMonth: false });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month, d);
      const iso = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
      cells.push({ dateObj: dt, dayNumber: d, dateIso: iso, isCurrentMonth: true });
    }

    // Trailing days to fill 35 or 42 cells
    const totalNeeded = cells.length > 35 ? 42 : 35;
    let nextDay = 1;
    while (cells.length < totalNeeded) {
      const dt = new Date(year, month + 1, nextDay++);
      const iso = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
      cells.push({ dateObj: dt, dayNumber: dt.getDate(), dateIso: iso, isCurrentMonth: false });
    }

    return cells;
  }, [currentMonthDate]);

  const monthTitle = currentMonthDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const selectedDayEvents = eventsByDate[selectedDateIso] || [];

  const courseOptions = useMemo(() => {
    const set = new Set();
    if (selectedCourse) set.add(selectedCourse);
    (courses || []).forEach((c) => {
      const n = typeof c === 'string' ? c : c?.course_name || c?.name || '';
      if (n) set.add(n);
    });
    return Array.from(set);
  }, [courses, selectedCourse]);

  const openModal = (tab) => {
    setModalInitialTab(tab);
    setModalOpen(true);
  };

  const renderEventCard = (evt) => {
    const catStyle = CATEGORY_META[evt.category] || CATEGORY_META.schedule;
    const srcStyle = SOURCE_BADGES[evt.source_type] || SOURCE_BADGES.moodle_ical;
    const meta = evt.source_metadata || {};
    const canDelete = evt.source_type && evt.source_type !== 'moodle_ical';

    return (
      <Box
        key={evt.id}
        data-testid={`calendar-page-event-${evt.id}`}
        sx={{
          p: 2,
          borderRadius: 2.5,
          border: `1px solid ${p.cardBorder}`,
          bgcolor: p.cardBg,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          transition: 'all 0.2s ease',
          '&:hover': {
            borderColor: p.primary,
            boxShadow: p.cardShadow
          }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
            <Chip
              size="small"
              label={catStyle.label}
              sx={{
                bgcolor: catStyle.bg,
                color: catStyle.color,
                border: `1px solid ${catStyle.border}`,
                fontWeight: 700,
                fontSize: '0.7rem',
                height: 22
              }}
            />
            <Chip
              size="small"
              label={srcStyle.label}
              sx={{
                bgcolor: srcStyle.bg,
                color: srcStyle.color,
                border: `1px solid ${srcStyle.border}`,
                fontWeight: 700,
                fontSize: '0.7rem',
                height: 22
              }}
            />
            {evt.course_name && (
              <Chip
                size="small"
                label={evt.course_name}
                sx={{
                  height: 22,
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  bgcolor: 'rgba(59,130,246,0.12)',
                  color: p.primary
                }}
              />
            )}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: p.textSecondary }}>
              <Clock size={13} />
              <Typography variant="caption" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                {evt.date_formatted ? `${evt.date_formatted} • ` : ''}
                {evt.is_all_day ? 'All Day' : `${evt.start_time_formatted || ''} - ${evt.end_time_formatted || ''}`}
              </Typography>
            </Box>
            {canDelete && (
              <Tooltip title="Remove event from calendar">
                <IconButton
                  size="small"
                  aria-label={`Delete event ${evt.title}`}
                  onClick={() => handleDeleteEvent(evt.id)}
                  sx={{ color: p.textSecondary, '&:hover': { color: '#ef4444' } }}
                >
                  <Trash2 size={14} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        <Typography variant="subtitle1" sx={{ fontWeight: 800, color: p.textPrimary, lineHeight: 1.3 }}>
          {evt.title}
        </Typography>

        {evt.location && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, color: p.textSecondary }}>
            <MapPin size={13} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {evt.location}
            </Typography>
          </Box>
        )}

        {evt.description && (
          <Typography variant="body2" sx={{ fontSize: '0.82rem', color: p.textSecondary }}>
            {evt.description}
          </Typography>
        )}

        {/* Provenance Deep-Links (Transcript Timestamp Jump or PDF Page Info) */}
        {(meta.video_id || meta.pdf_filename) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
            {meta.video_id && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<Video size={13} />}
                onClick={() => {
                  if (typeof onSelectLecture === 'function') {
                    onSelectLecture(meta.video_id, meta.cue_time || '00:00', evt.course_name || selectedCourse);
                  }
                }}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.74rem',
                  borderRadius: 2,
                  color: '#c084fc',
                  borderColor: 'rgba(168,85,247,0.4)'
                }}
              >
                Heard in {meta.lecture_title || 'Lecture'} @ {meta.cue_time || '00:00'}
              </Button>
            )}
            {meta.pdf_filename && (
              <Chip
                size="small"
                label={`Source: ${meta.pdf_filename}${meta.page_number ? ` (Page ${meta.page_number})` : ''}`}
                sx={{ fontSize: '0.7rem', height: 24, bgcolor: 'rgba(16,185,129,0.1)', color: '#34d399' }}
              />
            )}
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box
      data-testid="full-calendar-view"
      sx={{
        maxWidth: embeddedInCourse ? '100%' : '1240px',
        mx: 'auto',
        p: embeddedInCourse ? 0 : { xs: 2, md: 4 }
      }}
    >
      {/* Top Header Bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {onNavigateBack && !embeddedInCourse && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<ArrowLeft size={15} />}
              onClick={onNavigateBack}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: 2,
                color: p.primary,
                borderColor: p.cardBorder,
                bgcolor: p.cardBg
              }}
            >
              Back to Hub
            </Button>
          )}
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
              color: '#fff'
            }}
          >
            <CalendarIcon size={20} />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800, color: p.textPrimary, lineHeight: 1.2 }}>
              {selectedCourse ? `${selectedCourse} — Course Calendar & Exam Schedule` : 'LMS Academic Calendar & AI Schedule Hub'}
            </Typography>
            <Typography variant="caption" sx={{ color: p.textSecondary }}>
              Unified Moodle iCal feed, AI-extracted Semester Exam PDFs, and Lecture Transcript deadlines
            </Typography>
          </Box>
        </Box>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<FileText size={15} />}
            onClick={() => openModal('pdf')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              background: 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
              color: '#fff'
            }}
          >
            Upload Exam PDF (AI)
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Mic size={15} />}
            onClick={() => openModal('transcript')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              color: '#c084fc',
              borderColor: 'rgba(168,85,247,0.45)',
              bgcolor: 'rgba(168,85,247,0.08)'
            }}
          >
            Scan Transcripts (AI)
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<Plus size={15} />}
            onClick={() => openModal('manual')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              color: p.textPrimary,
              borderColor: p.cardBorder,
              bgcolor: p.cardBg
            }}
          >
            Add Event
          </Button>
          <Button
            component="a"
            href={`${API_BASE}/api/calendar/export.ics${courseFilter && courseFilter !== 'all' ? `?course=${encodeURIComponent(courseFilter)}` : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            variant="outlined"
            size="small"
            startIcon={<Download size={14} />}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              color: p.textSecondary,
              borderColor: p.cardBorder
            }}
          >
            Export .ics
          </Button>
          <Tooltip title="Sync & Refresh Calendar">
            <IconButton
              size="small"
              onClick={() => fetchCalendarData(true)}
              sx={{ color: p.textSecondary, border: `1px solid ${p.cardBorder}`, borderRadius: 2 }}
            >
              <RefreshCw size={15} className={loading ? 'loading-pulse' : ''} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Summary KPI Bar */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(5, 1fr)' }, gap: 1.5, mb: 3 }}>
        {[
          { label: 'Total Events', value: allEvents.length, color: p.primary },
          { label: 'Today', value: agenda?.counts?.today || 0, color: '#10b981' },
          { label: 'Exams / Vivas', value: allEvents.filter((e) => e.category === 'exam').length, color: '#ef4444' },
          { label: 'Quizzes & Tests', value: allEvents.filter((e) => e.category === 'quiz').length, color: '#a855f7' },
          { label: 'AI Extracted', value: allEvents.filter((e) => ['pdf_ai', 'transcript_ai'].includes(e.source_type)).length, color: '#38bdf8' }
        ].map((stat) => (
          <Box
            key={stat.label}
            sx={{
              p: 1.8,
              borderRadius: 2.5,
              bgcolor: p.cardBg,
              border: `1px solid ${p.cardBorder}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.3
            }}
          >
            <Typography variant="caption" sx={{ color: p.textSecondary, fontWeight: 700 }}>
              {stat.label}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, color: stat.color }}>
              {stat.value}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Filter & View Switcher Toolbar */}
      <Box
        sx={{
          p: 2,
          mb: 3,
          borderRadius: 2.5,
          bgcolor: p.cardBg,
          border: `1px solid ${p.cardBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5
        }}
      >
        {/* View Mode Tabs */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            size="small"
            variant={viewMode === 'month' ? 'contained' : 'outlined'}
            startIcon={<LayoutGrid size={14} />}
            onClick={() => setViewMode('month')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              ...(viewMode === 'month' ? { bgcolor: p.primary, color: '#fff' } : { color: p.textSecondary, borderColor: p.cardBorder })
            }}
          >
            Month Grid
          </Button>
          <Button
            size="small"
            variant={viewMode === 'timeline' ? 'contained' : 'outlined'}
            startIcon={<List size={14} />}
            onClick={() => setViewMode('timeline')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              ...(viewMode === 'timeline' ? { bgcolor: p.primary, color: '#fff' } : { color: p.textSecondary, borderColor: p.cardBorder })
            }}
          >
            Timeline Agenda ({allEvents.length})
          </Button>
          <Button
            size="small"
            variant={viewMode === 'ai' ? 'contained' : 'outlined'}
            startIcon={<Sparkles size={14} />}
            onClick={() => setViewMode('ai')}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              ...(viewMode === 'ai' ? { bgcolor: '#7c3aed', color: '#fff' } : { color: p.textSecondary, borderColor: p.cardBorder })
            }}
          >
            AI Extracted Only
          </Button>
        </Box>

        {/* Search, Course, Category & Source Filters */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search exams, topics, rooms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={14} color={p.textSecondary} />
                  </InputAdornment>
                ),
                sx: { fontSize: '0.82rem', borderRadius: 2, width: { xs: '100%', sm: 200 } }
              }
            }}
          />

          <TextField
            select
            size="small"
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            sx={{ minWidth: 155, '& .MuiInputBase-root': { fontSize: '0.82rem', borderRadius: 2 } }}
          >
            <MenuItem value="all">All Courses</MenuItem>
            {courseOptions.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            sx={{ minWidth: 135, '& .MuiInputBase-root': { fontSize: '0.82rem', borderRadius: 2 } }}
          >
            <MenuItem value="all">All Categories</MenuItem>
            <MenuItem value="exam">Exams / Vivas</MenuItem>
            <MenuItem value="quiz">Quizzes / Tests</MenuItem>
            <MenuItem value="assignment">Assignments</MenuItem>
            <MenuItem value="lab">Labs</MenuItem>
            <MenuItem value="lecture">Lectures</MenuItem>
          </TextField>

          <TextField
            select
            size="small"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            sx={{ minWidth: 140, '& .MuiInputBase-root': { fontSize: '0.82rem', borderRadius: 2 } }}
          >
            <MenuItem value="all">All Sources</MenuItem>
            <MenuItem value="pdf_ai">AI Exam PDF</MenuItem>
            <MenuItem value="transcript_ai">AI Transcript</MenuItem>
            <MenuItem value="moodle_ical">Moodle iCal</MenuItem>
            <MenuItem value="manual">Manual Events</MenuItem>
          </TextField>
        </Box>
      </Box>

      {/* VIEW 1: INTERACTIVE MONTH GRID + SELECTED DAY PANEL */}
      {viewMode === 'month' ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '2.2fr 1fr' }, gap: 2.5 }}>
          {/* Month Grid */}
          <Box sx={{ p: 2.5, borderRadius: 3, bgcolor: p.cardBg, border: `1px solid ${p.cardBorder}` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 800, color: p.textPrimary }}>
                {monthTitle}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    const now = new Date();
                    setCurrentMonthDate(new Date(now.getFullYear(), now.getMonth(), 1));
                    setSelectedDateIso(now.toISOString().slice(0, 10));
                  }}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, fontSize: '0.75rem' }}
                >
                  Today
                </Button>
                <IconButton
                  size="small"
                  aria-label="Previous Month"
                  onClick={() =>
                    setCurrentMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                  }
                  sx={{ border: `1px solid ${p.cardBorder}`, color: p.textPrimary }}
                >
                  <ChevronLeft size={16} />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label="Next Month"
                  onClick={() =>
                    setCurrentMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                  }
                  sx={{ border: `1px solid ${p.cardBorder}`, color: p.textPrimary }}
                >
                  <ChevronRight size={16} />
                </IconButton>
              </Box>
            </Box>

            {/* Weekday Headers */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.8, mb: 1 }}>
              {WEEKDAYS.map((day) => (
                <Typography
                  key={day}
                  variant="caption"
                  sx={{ textAlign: 'center', fontWeight: 800, color: p.textSecondary, py: 0.5 }}
                >
                  {day}
                </Typography>
              ))}
            </Box>

            {/* Calendar Day Cells */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.8 }}>
              {calendarCells.map((cell) => {
                const dayEvts = eventsByDate[cell.dateIso] || [];
                const isToday = cell.dateIso === todayIso;
                const isSelected = cell.dateIso === selectedDateIso;

                return (
                  <Box
                    key={cell.dateIso}
                    onClick={() => setSelectedDateIso(cell.dateIso)}
                    sx={{
                      minHeight: { xs: 68, sm: 92 },
                      p: 0.8,
                      borderRadius: 2,
                      cursor: 'pointer',
                      border: `1.5px solid ${
                        isSelected ? p.primary : isToday ? '#10b981' : p.cardBorder
                      }`,
                      bgcolor: isSelected
                        ? 'rgba(59, 130, 246, 0.10)'
                        : cell.isCurrentMonth
                          ? p.surface
                          : 'transparent',
                      opacity: cell.isCurrentMonth ? 1 : 0.42,
                      transition: 'all 0.15s ease',
                      '&:hover': {
                        borderColor: p.primary
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: isToday || isSelected ? 800 : 600,
                          color: isToday ? '#10b981' : p.textPrimary
                        }}
                      >
                        {cell.dayNumber}
                      </Typography>
                      {dayEvts.length > 0 && (
                        <Chip
                          size="small"
                          label={dayEvts.length}
                          sx={{ height: 16, fontSize: '0.65rem', fontWeight: 800, bgcolor: p.primary, color: '#fff' }}
                        />
                      )}
                    </Box>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                      {dayEvts.slice(0, 2).map((ev) => {
                        const catStyle = CATEGORY_META[ev.category] || CATEGORY_META.schedule;
                        return (
                          <Box
                            key={ev.id}
                            sx={{
                              px: 0.6,
                              py: 0.2,
                              borderRadius: 1,
                              bgcolor: catStyle.bg,
                              color: catStyle.color,
                              fontSize: '0.64rem',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {ev.title}
                          </Box>
                        );
                      })}
                      {dayEvts.length > 2 && (
                        <Typography variant="caption" sx={{ fontSize: '0.62rem', color: p.textSecondary, fontWeight: 700 }}>
                          +{dayEvts.length - 2} more
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* Right Panel: Selected Date Agenda */}
          <Box sx={{ p: 2.5, borderRadius: 3, bgcolor: p.cardBg, border: `1px solid ${p.cardBorder}`, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, color: p.textPrimary }}>
                  Schedule for {selectedDateIso}
                </Typography>
                <Typography variant="caption" sx={{ color: p.textSecondary }}>
                  {selectedDayEvents.length} {selectedDayEvents.length === 1 ? 'event' : 'events'} scheduled
                </Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Plus size={14} />}
                onClick={() => openModal('manual')}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, fontSize: '0.75rem' }}
              >
                Add on Date
              </Button>
            </Box>

            {selectedDayEvents.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center', color: p.textSecondary }}>
                <CalendarIcon size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  No events on {selectedDateIso}
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                  Click another highlighted date on the grid or upload an Exam PDF / scan transcripts.
                </Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxHeight: 540, overflowY: 'auto' }}>
                {selectedDayEvents.map((ev) => renderEventCard(ev))}
              </Box>
            )}
          </Box>
        </Box>
      ) : (
        /* VIEW 2 & 3: TIMELINE AGENDA / AI EXTRACTED LIST */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {loading ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <CircularProgress size={26} />
            </Box>
          ) : allEvents.length === 0 ? (
            <Box
              sx={{
                p: 5,
                borderRadius: 3,
                bgcolor: p.cardBg,
                border: `1px solid ${p.cardBorder}`,
                textAlign: 'center'
              }}
            >
              <Sparkles size={32} color={p.primary} style={{ marginBottom: 8 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 800, color: p.textPrimary }}>
                No matching calendar events found
              </Typography>
              <Typography variant="body2" sx={{ color: p.textSecondary, mt: 0.5, mb: 2 }}>
                Upload a Semester Exam PDF or scan your Course Lecture Transcripts to populate dates with AI.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<FileText size={15} />}
                  onClick={() => openModal('pdf')}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, bgcolor: p.primary, color: '#fff' }}
                >
                  Upload Exam PDF (AI)
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<Mic size={15} />}
                  onClick={() => openModal('transcript')}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
                >
                  Scan Lecture Transcripts (AI)
                </Button>
              </Box>
            </Box>
          ) : (
            allEvents.map((ev) => renderEventCard(ev))
          )}
        </Box>
      )}

      {/* AI Extractor & Manual Event Modal */}
      <CalendarAIExtractorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialTab={modalInitialTab}
        defaultCourse={courseFilter !== 'all' ? courseFilter : (selectedCourse || '')}
        defaultDateIso={selectedDateIso}
        courses={courseOptions}
        googleUser={googleUser}
        isTutor={isTutor}
        currentTheme={currentTheme}
        onEventsInjected={() => fetchCalendarData(false)}
      />
    </Box>
  );
}


import React, { useState, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Button,
  TextField,
  MenuItem,
  Chip,
  IconButton,
  Checkbox,
  CircularProgress,
  Switch,
  FormControlLabel,
  Tooltip
} from '@mui/material';
import {
  X,
  Upload,
  Sparkles,
  FileText,
  Mic,
  Plus,
  Calendar as CalendarIcon,
  Check,
  AlertCircle,
  Clock,
  MapPin
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';

const CATEGORIES = [
  { value: 'exam', label: 'Exam / Viva' },
  { value: 'quiz', label: 'Quiz / Test' },
  { value: 'assignment', label: 'Assignment Due' },
  { value: 'lab', label: 'Lab Session' },
  { value: 'lecture', label: 'Lecture' },
  { value: 'schedule', label: 'General Schedule' }
];

export default function CalendarAIExtractorModal({
  open,
  onClose,
  initialTab = 'pdf', // 'pdf' | 'transcript' | 'manual'
  defaultCourse = '',
  defaultDateIso = '',
  videoId = '',
  lectureTitle = '',
  courses = [],
  googleUser = null,
  isTutor = false,
  currentTheme,
  onEventsInjected
}) {
  const [activeTab, setActiveTab] = useState(initialTab || 'pdf');
  const [selectedFile, setSelectedFile] = useState(null);
  const [targetCourse, setTargetCourse] = useState(defaultCourse || '');
  const [eventScope, setEventScope] = useState(isTutor ? (defaultCourse ? 'course' : 'site') : 'user');
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [stagedEvents, setStagedEvents] = useState([]);
  const [selectedIndices, setSelectedIndices] = useState(new Set());
  const fileInputRef = useRef(null);

  // Manual event form state
  const [manualTitle, setManualTitle] = useState('');
  const [manualCategory, setManualCategory] = useState('exam');
  const [manualDate, setManualDate] = useState(
    defaultDateIso || new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  );
  const [manualStartTime, setManualStartTime] = useState('09:30');
  const [manualEndTime, setManualEndTime] = useState('12:30');
  const [manualAllDay, setManualAllDay] = useState(false);
  const [manualLocation, setManualLocation] = useState('');
  const [manualDescription, setManualDescription] = useState('');

  React.useEffect(() => {
    if (open) {
      setActiveTab(initialTab || 'pdf');
      setTargetCourse(defaultCourse || '');
      setEventScope(isTutor ? (defaultCourse ? 'course' : 'site') : 'user');
      if (defaultDateIso) {
        setManualDate(defaultDateIso);
      }
      setError(null);
      setSuccessMsg(null);
    }
  }, [open, initialTab, defaultCourse, defaultDateIso, isTutor]);

  const p = currentTheme?.palette || {
    cardBg: '#1e293b',
    cardBorder: 'rgba(255,255,255,0.12)',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    primary: '#3b82f6',
    surface: 'rgba(255,255,255,0.03)'
  };

  const courseOptions = React.useMemo(() => {
    const names = new Set();
    if (defaultCourse) names.add(defaultCourse);
    (courses || []).forEach((c) => {
      const n = typeof c === 'string' ? c : c?.course_name || c?.name || '';
      if (n) names.add(n);
    });
    return Array.from(names);
  }, [courses, defaultCourse]);

  const handleExtractPdf = async (directInject = false) => {
    if (!selectedFile) {
      setError('Please select a Semester Exam PDF or Course Schedule PDF first.');
      return;
    }
    setExtracting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (targetCourse) formData.append('course_name', targetCourse);
      if (eventScope) formData.append('event_scope', eventScope);
      if (googleUser?.email) formData.append('user_email', googleUser.email);
      formData.append('auto_save', directInject ? 'true' : 'false');

      const res = await fetch(`${API_BASE}/api/calendar/extract-pdf`, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `HTTP ${res.status}: Failed to extract PDF dates`);
      }
      const data = await res.json();
      const extracted = data.events || [];
      setStagedEvents(extracted);
      setSelectedIndices(new Set(extracted.map((_, i) => i)));

      if (extracted.length === 0) {
        setError('No exam dates or schedule items were found in this PDF.');
      } else if (directInject) {
        setSuccessMsg(`Extracted and injected ${extracted.length} events into the calendar!`);
        if (onEventsInjected) onEventsInjected(extracted);
      } else {
        setSuccessMsg(`AI extracted ${extracted.length} candidate events from "${selectedFile.name}". Review below & click Inject.`);
      }
    } catch (err) {
      setError(err.message || 'Failed to extract dates from PDF.');
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractTranscript = async (directInject = false) => {
    if (!videoId && !targetCourse) {
      setError('Please select a course or open a lecture to scan transcripts.');
      return;
    }
    setExtracting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/calendar/extract-transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId || undefined,
          course_name: targetCourse || undefined,
          user_email: googleUser?.email || '',
          auto_save: directInject
        })
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `HTTP ${res.status}: Transcript scan failed`);
      }
      const data = await res.json();
      const extracted = data.events || [];
      setStagedEvents(extracted);
      setSelectedIndices(new Set(extracted.map((_, i) => i)));

      if (extracted.length === 0) {
        setError('No upcoming quiz, exam, or assignment dates were announced in the scanned transcript(s).');
      } else if (directInject) {
        setSuccessMsg(`Injected ${extracted.length} transcript-announced events into the calendar!`);
        if (onEventsInjected) onEventsInjected(extracted);
      } else {
        setSuccessMsg(`Found ${extracted.length} announced dates across ${data.scanned_lectures || 1} lecture(s). Review & click Inject.`);
      }
    } catch (err) {
      setError(err.message || 'Failed to scan transcripts for dates.');
    } finally {
      setExtracting(false);
    }
  };

  const handleInjectStagedEvents = async () => {
    const chosen = stagedEvents.filter((_, idx) => selectedIndices.has(idx));
    if (chosen.length === 0) {
      setError('Select at least one event to inject into the calendar.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payloadEvents = chosen.map((ev) => ({
        ...ev,
        course_name: ev.course_name || targetCourse || '',
        event_scope: ev.event_scope || eventScope,
        created_by_email: googleUser?.email || '',
        approval_status: 'approved'
      }));
      const res = await fetch(`${API_BASE}/api/calendar/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: payloadEvents })
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to inject calendar events`);
      }
      const data = await res.json();
      setSuccessMsg(`Successfully injected ${data.count || chosen.length} events into the calendar!`);
      setStagedEvents([]);
      if (onEventsInjected) onEventsInjected(data.events || payloadEvents);
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      setError(err.message || 'Failed to save calendar events.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveManualEvent = async () => {
    if (!manualTitle.trim()) {
      setError('Please enter an event title.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const startIso = manualAllDay
        ? `${manualDate}T00:00:00+05:30`
        : `${manualDate}T${manualStartTime}:00+05:30`;
      const endIso = manualAllDay
        ? `${manualDate}T23:59:59+05:30`
        : `${manualDate}T${manualEndTime}:00+05:30`;

      const newEvt = {
        title: manualTitle.trim(),
        category: manualCategory,
        start_time: startIso,
        end_time: endIso,
        is_all_day: manualAllDay,
        location: manualLocation.trim(),
        description: manualDescription.trim(),
        course_name: targetCourse,
        event_scope: eventScope,
        created_by_email: googleUser?.email || '',
        source_type: 'manual',
        approval_status: 'approved'
      };

      const res = await fetch(`${API_BASE}/api/calendar/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEvt)
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Could not create event`);
      }
      const data = await res.json();
      setSuccessMsg('Event added to calendar!');
      setManualTitle('');
      setManualDescription('');
      if (onEventsInjected) onEventsInjected(data.events || [newEvt]);
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      setError(err.message || 'Failed to add manual event.');
    } finally {
      setSaving(false);
    }
  };

  const updateStagedField = (idx, field, value) => {
    setStagedEvents((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, [field]: value };
        if (field === 'date_iso') {
          const timePart = (item.start || '').split('T')[1] || '09:30:00+05:30';
          const endPart = (item.end || '').split('T')[1] || '12:30:00+05:30';
          updated.start = `${value}T${timePart}`;
          updated.end = `${value}T${endPart}`;
        }
        return updated;
      })
    );
  };

  const toggleSelectIdx = (idx) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: p.cardBg,
          color: p.textPrimary,
          border: `1px solid ${p.cardBorder}`,
          borderRadius: 3,
          backgroundImage: 'none'
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1.5, borderBottom: `1px solid ${p.cardBorder}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
              color: '#fff'
            }}
          >
            <Sparkles size={18} />
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
              AI Academic Calendar & Schedule Injector
            </Typography>
            <Typography variant="caption" sx={{ color: p.textSecondary }}>
              Extract dates from Semester Exam PDFs, Lecture Transcripts, or add manual LMS deadlines
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: p.textSecondary }} aria-label="Close calendar modal">
          <X size={18} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 2.5 }}>
        {/* Mode Switcher Tabs */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap' }}>
          <Button
            variant={activeTab === 'pdf' ? 'contained' : 'outlined'}
            size="small"
            startIcon={<FileText size={15} />}
            onClick={() => {
              setActiveTab('pdf');
              setError(null);
            }}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              ...(activeTab === 'pdf'
                ? { bgcolor: p.primary, color: '#fff' }
                : { color: p.textSecondary, borderColor: p.cardBorder })
            }}
          >
            Exam / Timetable PDF (AI)
          </Button>
          <Button
            variant={activeTab === 'transcript' ? 'contained' : 'outlined'}
            size="small"
            startIcon={<Mic size={15} />}
            onClick={() => {
              setActiveTab('transcript');
              setError(null);
            }}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              ...(activeTab === 'transcript'
                ? { bgcolor: p.primary, color: '#fff' }
                : { color: p.textSecondary, borderColor: p.cardBorder })
            }}
          >
            Lecture Transcript Dates (AI)
          </Button>
          <Button
            variant={activeTab === 'manual' ? 'contained' : 'outlined'}
            size="small"
            startIcon={<Plus size={15} />}
            onClick={() => {
              setActiveTab('manual');
              setError(null);
            }}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2,
              ...(activeTab === 'manual'
                ? { bgcolor: p.primary, color: '#fff' }
                : { color: p.textSecondary, borderColor: p.cardBorder })
            }}
          >
            Add Manual Event
          </Button>
        </Box>

        {/* Common Course & Scope Bar */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5, mb: 2.5 }}>
          <TextField
            select
            size="small"
            label="Target Course (Optional)"
            value={targetCourse}
            onChange={(e) => setTargetCourse(e.target.value)}
            sx={{ '& .MuiInputBase-root': { color: p.textPrimary } }}
          >
            <MenuItem value="">All Courses / Auto-Detect from Content</MenuItem>
            {courseOptions.map((cName) => (
              <MenuItem key={cName} value={cName}>
                {cName}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            size="small"
            label="Calendar Visibility Scope"
            value={eventScope}
            onChange={(e) => setEventScope(e.target.value)}
            sx={{ '& .MuiInputBase-root': { color: p.textPrimary } }}
          >
            {isTutor && <MenuItem value="site">Semester-Wide (All Courses & Students)</MenuItem>}
            <MenuItem value="course">Course Calendar ({targetCourse || 'Matched Course'})</MenuItem>
            <MenuItem value="user">My Personal Calendar Only</MenuItem>
          </TextField>
        </Box>

        {error && (
          <Box sx={{ p: 1.5, mb: 2, borderRadius: 2, bgcolor: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', color: '#f87171', display: 'flex', alignItems: 'center', gap: 1, fontSize: '0.85rem' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </Box>
        )}

        {successMsg && (
          <Box sx={{ p: 1.5, mb: 2, borderRadius: 2, bgcolor: 'rgba(16,185,129,0.12)', border: '1px solid #10b981', color: '#34d399', display: 'flex', alignItems: 'center', gap: 1, fontSize: '0.85rem', fontWeight: 600 }}>
            <Check size={16} />
            <span>{successMsg}</span>
          </Box>
        )}

        {/* TAB 1: PDF EXTRACTOR */}
        {activeTab === 'pdf' && (
          <Box>
            <Box
              onClick={() => fileInputRef.current?.click()}
              sx={{
                p: 3,
                borderRadius: 2.5,
                border: `2px dashed ${selectedFile ? p.primary : p.cardBorder}`,
                bgcolor: p.surface,
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': { borderColor: p.primary }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                aria-label="Upload Semester Exam PDF"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setSelectedFile(f);
                    setError(null);
                  }
                }}
              />
              <Upload size={28} color={p.primary} style={{ marginBottom: 8 }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: p.textPrimary }}>
                {selectedFile ? selectedFile.name : 'Click to select Semester Exam Timetable or Syllabus PDF'}
              </Typography>
              <Typography variant="caption" sx={{ color: p.textSecondary, display: 'block', mt: 0.5 }}>
                Supports multi-column exam date sheets, scanned timetables (Gemini Vision), and course syllabi
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 1.5, mt: 2, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                size="small"
                disabled={!selectedFile || extracting}
                startIcon={extracting ? <CircularProgress size={14} /> : <Sparkles size={15} />}
                onClick={() => handleExtractPdf(false)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
              >
                {extracting ? 'Extracting Dates with AI...' : 'Extract & Preview Dates'}
              </Button>
              <Button
                variant="contained"
                size="small"
                disabled={!selectedFile || extracting}
                startIcon={extracting ? <CircularProgress size={14} color="inherit" /> : <CalendarIcon size={15} />}
                onClick={() => handleExtractPdf(true)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, bgcolor: p.primary, color: '#fff' }}
              >
                Extract & Auto-Inject into Calendar
              </Button>
            </Box>
          </Box>
        )}

        {/* TAB 2: TRANSCRIPT EXTRACTOR */}
        {activeTab === 'transcript' && (
          <Box sx={{ p: 2.5, borderRadius: 2.5, border: `1px solid ${p.cardBorder}`, bgcolor: p.surface }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
              {videoId
                ? `Scan Lecture: ${lectureTitle || videoId}`
                : targetCourse
                  ? `Scan All Lecture Transcripts in "${targetCourse}"`
                  : 'Select a Course above to scan its lecture transcripts for announced dates'}
            </Typography>
            <Typography variant="caption" sx={{ color: p.textSecondary, display: 'block', mb: 2 }}>
              Detects professor announcements of upcoming quizzes, midsems, endsems, assignment deadlines, and rescheduled classes, linking each calendar event directly to the exact video timestamp.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                size="small"
                disabled={(!videoId && !targetCourse) || extracting}
                startIcon={extracting ? <CircularProgress size={14} /> : <Mic size={15} />}
                onClick={() => handleExtractTranscript(false)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
              >
                {extracting ? 'Scanning Transcripts...' : 'Scan & Preview Dates'}
              </Button>
              <Button
                variant="contained"
                size="small"
                disabled={(!videoId && !targetCourse) || extracting}
                startIcon={extracting ? <CircularProgress size={14} color="inherit" /> : <Sparkles size={15} />}
                onClick={() => handleExtractTranscript(true)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, bgcolor: p.primary, color: '#fff' }}
              >
                Scan & Inject into Calendar
              </Button>
            </Box>
          </Box>
        )}

        {/* TAB 3: MANUAL EVENT FORM */}
        {activeTab === 'manual' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 1.5 }}>
              <TextField
                size="small"
                label="Event Title *"
                placeholder="e.g., End-Semester Exam: Deep Learning"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                fullWidth
              />
              <TextField
                select
                size="small"
                label="Category"
                value={manualCategory}
                onChange={(e) => setManualCategory(e.target.value)}
                fullWidth
              >
                {CATEGORIES.map((cat) => (
                  <MenuItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr auto' }, gap: 1.5, alignItems: 'center' }}>
              <TextField
                size="small"
                type="date"
                label="Date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              {!manualAllDay && (
                <>
                  <TextField
                    size="small"
                    type="time"
                    label="Start Time"
                    value={manualStartTime}
                    onChange={(e) => setManualStartTime(e.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <TextField
                    size="small"
                    type="time"
                    label="End Time"
                    value={manualEndTime}
                    onChange={(e) => setManualEndTime(e.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </>
              )}
              <FormControlLabel
                control={<Switch checked={manualAllDay} onChange={(e) => setManualAllDay(e.target.checked)} size="small" />}
                label={<Typography variant="caption">All Day</Typography>}
              />
            </Box>

            <TextField
              size="small"
              label="Location / Exam Hall / Meeting Link"
              placeholder="e.g., LH-201 or https://meet.google.com/..."
              value={manualLocation}
              onChange={(e) => setManualLocation(e.target.value)}
              fullWidth
            />

            <TextField
              size="small"
              label="Description / Syllabus Notes"
              multiline
              rows={2}
              placeholder="Units covered, seating instructions, or submission guidelines..."
              value={manualDescription}
              onChange={(e) => setManualDescription(e.target.value)}
              fullWidth
            />

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                disabled={saving}
                startIcon={<Plus size={16} />}
                onClick={handleSaveManualEvent}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, bgcolor: p.primary, color: '#fff' }}
              >
                {saving ? 'Saving...' : 'Add Event to Calendar'}
              </Button>
            </Box>
          </Box>
        )}

        {/* STAGED AI EVENTS PREVIEW & EDIT LIST */}
        {activeTab !== 'manual' && stagedEvents.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Extracted Candidate Events ({selectedIndices.size} of {stagedEvents.length} selected)
              </Typography>
              <Button
                size="small"
                onClick={() => {
                  if (selectedIndices.size === stagedEvents.length) {
                    setSelectedIndices(new Set());
                  } else {
                    setSelectedIndices(new Set(stagedEvents.map((_, i) => i)));
                  }
                }}
                sx={{ textTransform: 'none', fontSize: '0.75rem', fontWeight: 700 }}
              >
                {selectedIndices.size === stagedEvents.length ? 'Deselect All' : 'Select All'}
              </Button>
            </Box>

            <Box sx={{ maxHeight: 310, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.2, pr: 0.5 }}>
              {stagedEvents.map((ev, idx) => {
                const isSelected = selectedIndices.has(idx);
                const meta = ev.source_metadata || {};
                return (
                  <Box
                    key={ev.id || idx}
                    sx={{
                      p: 1.5,
                      borderRadius: 2,
                      border: `1px solid ${isSelected ? p.primary : p.cardBorder}`,
                      bgcolor: p.surface,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Checkbox
                        size="small"
                        checked={isSelected}
                        onChange={() => toggleSelectIdx(idx)}
                        sx={{ p: 0.5 }}
                      />
                      <TextField
                        size="small"
                        value={ev.title || ''}
                        onChange={(e) => updateStagedField(idx, 'title', e.target.value)}
                        sx={{ flex: 1, minWidth: 180 }}
                      />
                      <TextField
                        select
                        size="small"
                        value={ev.category || 'exam'}
                        onChange={(e) => updateStagedField(idx, 'category', e.target.value)}
                        sx={{ width: 135 }}
                      >
                        {CATEGORIES.map((c) => (
                          <MenuItem key={c.value} value={c.value}>
                            {c.label}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        size="small"
                        type="date"
                        value={ev.date_iso || (ev.start || '').slice(0, 10)}
                        onChange={(e) => updateStagedField(idx, 'date_iso', e.target.value)}
                        sx={{ width: 145 }}
                      />
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pl: 4, flexWrap: 'wrap', gap: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          label={`${ev.start_time_formatted || '09:30 AM'} - ${ev.end_time_formatted || '12:30 PM'}`}
                          sx={{ height: 20, fontSize: '0.7rem', fontWeight: 600 }}
                        />
                        {ev.course_name && (
                          <Chip
                            size="small"
                            label={ev.course_name}
                            sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}
                          />
                        )}
                        {meta.cue_time && (
                          <Chip
                            size="small"
                            label={`🎙️ @ ${meta.cue_time}`}
                            sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: 'rgba(168,85,247,0.15)', color: '#c084fc' }}
                          />
                        )}
                        {meta.page_number && (
                          <Chip
                            size="small"
                            label={`📄 Page ${meta.page_number}`}
                            sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: 'rgba(16,185,129,0.15)', color: '#34d399' }}
                          />
                        )}
                      </Box>

                      {(meta.raw_quote || meta.cue_text) && (
                        <Typography variant="caption" sx={{ color: p.textSecondary, fontStyle: 'italic', maxWidth: '100%' }}>
                          "{(meta.raw_quote || meta.cue_text).slice(0, 110)}"
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${p.cardBorder}`, justifyContent: 'space-between' }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', color: p.textSecondary, fontWeight: 600 }}>
          Close
        </Button>
        {activeTab !== 'manual' && stagedEvents.length > 0 && (
          <Button
            variant="contained"
            disabled={saving || selectedIndices.size === 0}
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <Check size={16} />}
            onClick={handleInjectStagedEvents}
            sx={{
              textTransform: 'none',
              fontWeight: 800,
              borderRadius: 2,
              bgcolor: '#10b981',
              color: '#fff',
              '&:hover': { bgcolor: '#059669' }
            }}
          >
            {saving ? 'Injecting...' : `Inject Selected Events into Calendar (${selectedIndices.size})`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}


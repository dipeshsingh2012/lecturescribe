import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../utils/constants';
import { normalizeCourseSlug } from '../utils/routing';

export function useCourseNotes(selectedCourse, googleUser, activeNoteId = null) {
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [activeNote, setActiveNote] = useState(null);
  const [activeNoteLoading, setActiveNoteLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'unsaved' | 'error'

  const userEmail = googleUser?.email || '';
  const lastFetchedNotesCourseRef = useRef('');

  // Fetch all notes for course
  const fetchCourseNotes = useCallback(async (courseName, email) => {
    const e = email || userEmail;
    const c = courseName || selectedCourse;
    if (!c || !e) {
      setNotes([]);
      return;
    }
    const slug = normalizeCourseSlug(c) || c;
    setNotesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(slug)}/notes?user_email=${encodeURIComponent(e)}`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
        lastFetchedNotesCourseRef.current = `${slug}::${e}`;
      }
    } catch (err) {
      console.error('[useCourseNotes] Error fetching notes:', err);
    } finally {
      setNotesLoading(false);
    }
  }, [selectedCourse, userEmail]);

  // Fetch active note details
  const fetchNote = useCallback(async (courseName, noteId, email) => {
    const e = email || userEmail;
    const c = courseName || selectedCourse;
    if (!c || !noteId || !e) return null;

    setActiveNoteLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(c)}/notes/${encodeURIComponent(noteId)}?user_email=${encodeURIComponent(e)}`);
      if (res.ok) {
        const data = await res.json();
        setActiveNote(data.note);
        setSaveStatus('saved');
        return data.note;
      }
    } catch (err) {
      console.error('[useCourseNotes] Error fetching note:', err);
    } finally {
      setActiveNoteLoading(false);
    }
    return null;
  }, [selectedCourse, userEmail]);

  // Create a new note
  const createNote = useCallback(async (courseName, email, title = 'Untitled Note', content = '', noteId = null) => {
    const e = email || userEmail;
    const c = courseName || selectedCourse;
    if (!c || !e) return null;

    try {
      const payload = {
        user_email: e,
        title: title || 'Untitled Note',
        content: content || ''
      };
      if (noteId) {
        payload.note_id = noteId;
      }
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(c)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        const newNote = data.note;
        setNotes((prev) => [newNote, ...prev.filter((n) => n.note_id !== newNote.note_id)]);
        setActiveNote((prev) => (prev && prev.note_id === newNote.note_id ? { ...newNote, ...prev } : newNote));
        setSaveStatus('saved');
        return newNote;
      }
    } catch (err) {
      console.error('[useCourseNotes] Error creating note:', err);
    }
    return null;
  }, [selectedCourse, userEmail]);

  // Save/update note
  const saveNote = useCallback(async (courseName, noteId, email, { title, content }) => {
    const e = email || userEmail;
    const c = courseName || selectedCourse;
    if (!c || !noteId || !e) return null;

    setSaveStatus('saving');
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(c)}/notes/${encodeURIComponent(noteId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: e,
          title,
          content
        })
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.note;
        setActiveNote(updated);
        setNotes((prev) => {
          const exists = prev.some((n) => n.note_id === noteId);
          if (exists) {
            return prev.map((n) => (n.note_id === noteId ? { ...n, ...updated } : n));
          }
          return [updated, ...prev];
        });
        setSaveStatus('saved');
        return updated;
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error('[useCourseNotes] Error saving note:', err);
      setSaveStatus('error');
    }
    return null;
  }, [selectedCourse, userEmail]);

  // Delete note
  const deleteNote = useCallback(async (courseName, noteId, email) => {
    const e = email || userEmail;
    const c = courseName || selectedCourse;
    if (!c || !noteId || !e) return false;

    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(c)}/notes/${encodeURIComponent(noteId)}?user_email=${encodeURIComponent(e)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setNotes((prev) => prev.filter((n) => n.note_id !== noteId));
        if (activeNote?.note_id === noteId) {
          setActiveNote(null);
        }
        return true;
      }
    } catch (err) {
      console.error('[useCourseNotes] Error deleting note:', err);
    }
    return false;
  }, [selectedCourse, userEmail, activeNote]);

  // Initial load when selectedCourse and userEmail are present
  useEffect(() => {
    if (selectedCourse && userEmail) {
      const slug = normalizeCourseSlug(selectedCourse) || selectedCourse;
      if (lastFetchedNotesCourseRef.current === `${slug}::${userEmail}`) {
        return;
      }
      fetchCourseNotes(selectedCourse, userEmail);
    } else {
      lastFetchedNotesCourseRef.current = '';
      setNotes([]);
      setActiveNote(null);
    }
  }, [selectedCourse, userEmail, fetchCourseNotes]);

  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;

  // Fetch active note when activeNoteId changes
  useEffect(() => {
    if (activeNoteId && selectedCourse && userEmail) {
      if (
        activeNoteRef.current &&
        activeNoteRef.current.note_id === activeNoteId &&
        typeof activeNoteRef.current.content === 'string'
      ) {
        return;
      }
      fetchNote(selectedCourse, activeNoteId, userEmail);
    } else if (!activeNoteId) {
      setActiveNote(null);
    }
  }, [activeNoteId, selectedCourse, userEmail, fetchNote]);

  return {
    notes,
    setNotes,
    notesLoading,
    activeNote,
    setActiveNote,
    activeNoteLoading,
    saveStatus,
    setSaveStatus,
    fetchCourseNotes,
    fetchNote,
    createNote,
    saveNote,
    deleteNote
  };
}

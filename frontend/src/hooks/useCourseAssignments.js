import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../utils/constants';
import { normalizeCourseSlug } from '../utils/routing';

export function useCourseAssignments(courseName, userEmail = null) {
  const cleanCourse = (courseName || '').trim();
  const courseSlug = normalizeCourseSlug(cleanCourse);

  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const pollingRef = useRef(null);

  const fetchAssignments = useCallback(async () => {
    if (!courseSlug) return;
    setLoading(true);
    setError(null);
    try {
      const emailQuery = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments${emailQuery}`);
      if (!res.ok) {
        throw new Error(`Failed to load assignments: ${res.statusText}`);
      }
      const data = await res.json();
      setAssignments(data.assignments || []);
    } catch (err) {
      console.error('[useCourseAssignments] fetch error:', err);
      setError(err.message || 'Could not load assignments.');
    } finally {
      setLoading(false);
    }
  }, [courseSlug, userEmail]);

  // Initial fetch on course change
  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  // Poll active assignments that are 'pending' or 'processing' or 'generating'
  useEffect(() => {
    const hasActiveJobs = assignments.some(
      (a) => a.status === 'pending' || a.status === 'processing' || a.status === 'generating'
    );

    if (hasActiveJobs) {
      if (!pollingRef.current) {
        pollingRef.current = setInterval(async () => {
          try {
            const emailQuery = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
            const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments${emailQuery}`);
            if (res.ok) {
              const data = await res.json();
              setAssignments(data.assignments || []);
            }
          } catch (e) {
            console.warn('[useCourseAssignments] Polling update error:', e);
          }
        }, 3500);
      }
    } else if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [assignments, courseSlug, userEmail]);

  // Upload Assignment PDF with optional initial dataset
  const uploadAssignment = useCallback(async (file, customTitle = '', datasetFile = null) => {
    if (!file || !courseSlug) return null;
    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append('file', file);
    if (customTitle.trim()) {
      formData.append('title', customTitle.trim());
    }
    if (datasetFile) {
      formData.append('dataset_file', datasetFile);
    }
    if (userEmail) {
      formData.append('user_email', userEmail);
    }

    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/upload`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Upload failed with status ${res.status}`);
      }

      const data = await res.json();
      if (data.record) {
        setAssignments((prev) => [data.record, ...prev.filter((x) => x.assignment_id !== data.record.assignment_id)]);
      } else {
        await fetchAssignments();
      }
      return data;
    } catch (err) {
      console.error('[useCourseAssignments] upload error:', err);
      setUploadError(err.message || 'Upload failed.');
      throw err;
    } finally {
      setUploading(false);
    }
  }, [courseSlug, userEmail, fetchAssignments]);

  // Provide missing dataset file to resume execution (Interactive Pause and Prompt)
  const provideDataset = useCallback(async (assignmentId, datasetFile) => {
    if (!assignmentId || !datasetFile || !courseSlug) return null;
    const formData = new FormData();
    formData.append('file', datasetFile);

    // Optimistically update assignment card to processing
    setAssignments((prev) =>
      prev.map((a) => (a.assignment_id === assignmentId ? { ...a, status: 'processing', error_message: null } : a))
    );

    try {
      const res = await fetch(
        `${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(assignmentId)}/provide-dataset`,
        {
          method: 'POST',
          body: formData
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Dataset upload failed (${res.status})`);
      }

      const data = await res.json();
      await fetchAssignments();
      return data;
    } catch (err) {
      console.error('[useCourseAssignments] provideDataset error:', err);
      await fetchAssignments();
      throw err;
    }
  }, [courseSlug, fetchAssignments]);

  // Delete Assignment
  const deleteAssignment = useCallback(async (assignmentId) => {
    if (!assignmentId || !courseSlug) return;
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(assignmentId)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setAssignments((prev) => prev.filter((a) => a.assignment_id !== assignmentId));
      }
    } catch (err) {
      console.error('[useCourseAssignments] delete error:', err);
    }
  }, [courseSlug]);

  // Regenerate Assignment
  const regenerateAssignment = useCallback(async (assignmentId) => {
    if (!assignmentId || !courseSlug) return;
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseSlug)}/assignments/${encodeURIComponent(assignmentId)}/regenerate`, {
        method: 'POST'
      });
      if (res.ok) {
        setAssignments((prev) =>
          prev.map((a) => (a.assignment_id === assignmentId ? { ...a, status: 'pending', error_message: null } : a))
        );
      }
    } catch (err) {
      console.error('[useCourseAssignments] regenerate error:', err);
    }
  }, [courseSlug]);

  return {
    assignments,
    loading,
    error,
    uploading,
    uploadError,
    uploadAssignment,
    provideDataset,
    regenerateAssignment,
    deleteAssignment,
    refetchAssignments: fetchAssignments
  };
}


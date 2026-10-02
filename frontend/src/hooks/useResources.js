import { useState, useEffect, useRef, useMemo } from 'react';
import { API_BASE } from '../utils/constants';

export function useResources(activeVideoId, selectedCourse, googleUser) {
  const [rawLectureResources, setRawLectureResources] = useState([]);
  const [lectureResourcesLoading, setLectureResourcesLoading] = useState(false);
  const [courseResources, setCourseResources] = useState([]);
  const [courseResourcesLoading, setCourseResourcesLoading] = useState(false);
  const [courseViewTab, setCourseViewTab] = useState('lectures'); // 'lectures' | 'resources'
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState({ courseName: 'General Lectures', videoId: null });
  const [uploadMode, setUploadMode] = useState('file'); // 'file' | 'link'
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadLinkUrl, setUploadLinkUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const fetchLectureResources = async (videoId, courseName) => {
    if (!videoId) {
      setRawLectureResources([]);
      return;
    }
    setLectureResourcesLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const courseQuery = courseName ? `?course_name=${encodeURIComponent(courseName)}` : '';
      const res = await fetch(`${API_BASE}/api/lecture/${encodeURIComponent(videoId)}/resources${courseQuery}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        setRawLectureResources(data.resources || []);
      }
    } catch (err) {
      console.warn("Failed to load lecture resources:", err);
    } finally {
      clearTimeout(timeoutId);
      setLectureResourcesLoading(false);
    }
  };

  useEffect(() => {
    if (activeVideoId) {
      fetchLectureResources(activeVideoId, selectedCourse);
    } else {
      setRawLectureResources([]);
    }
  }, [activeVideoId, selectedCourse]);

  const lectureResources = useMemo(() => {
    const map = new Map();
    (rawLectureResources || []).forEach(r => {
      if (r && r.id) map.set(r.id, r);
    });
    (courseResources || []).forEach(r => {
      if (r && r.id) {
        const vid = r.video_id;
        const isCourseWide = !vid || vid === 'general' || vid === 'null' || String(vid).trim() === '';
        if (isCourseWide && !map.has(r.id)) {
          map.set(r.id, r);
        }
      }
    });
    return Array.from(map.values());
  }, [rawLectureResources, courseResources]);

  const fetchCourseResources = async (courseName) => {
    if (!courseName) {
      setCourseResources([]);
      return;
    }
    setCourseResourcesLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseName)}/resources`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        setCourseResources(data.resources || []);
      }
    } catch (err) {
      console.warn("Failed to load course resources:", err);
    } finally {
      clearTimeout(timeoutId);
      setCourseResourcesLoading(false);
    }
  };

  const lastCourseSlugRef = useRef('');

  useEffect(() => {
    if (selectedCourse) {
      const slug = selectedCourse.trim().toLowerCase();
      if (lastCourseSlugRef.current === slug) return;
      lastCourseSlugRef.current = slug;
      fetchCourseResources(selectedCourse);
    } else {
      lastCourseSlugRef.current = '';
      setCourseResources([]);
    }
  }, [selectedCourse]);

  const openUploadModal = (target = { courseName: selectedCourse || 'General Lectures', videoId: activeVideoId || null }) => {
    setUploadTarget(target);
    setUploadFile(null);
    setUploadTitle('');
    setUploadLinkUrl('');
    setUploadError('');
    setUploadMode('file');
    setUploadModalOpen(true);
  };

  const handleUploadResource = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!googleUser?.email) {
      setUploadError("Please sign in with Google to upload resources.");
      return;
    }

    setIsUploading(true);
    setUploadError('');

    try {
      if (uploadMode === 'file') {
        if (!uploadFile) {
          throw new Error("Please select a file to upload.");
        }

        const presignRes = await fetch(`${API_BASE}/api/resources/presign-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            course_name: uploadTarget.courseName || selectedCourse || 'General Lectures',
            video_id: uploadTarget.videoId || null,
            filename: uploadFile.name,
            content_type: uploadFile.type || 'application/octet-stream',
            user_email: googleUser.email
          })
        });

        if (!presignRes.ok) {
          const errData = await presignRes.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to get secure upload authorization.");
        }

        const presignData = await presignRes.json();

        const gcsRes = await fetch(presignData.signed_url, {
          method: 'PUT',
          headers: {
            'Content-Type': uploadFile.type || 'application/octet-stream'
          },
          body: uploadFile
        });

        if (!gcsRes.ok) {
          throw new Error(`Cloud storage upload failed (HTTP ${gcsRes.status}).`);
        }

        const confirmRes = await fetch(`${API_BASE}/api/resources/confirm-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            course_name: uploadTarget.courseName || selectedCourse,
            video_id: uploadTarget.videoId || null,
            title: uploadTitle.trim() || uploadFile.name.replace(/\.[^/.]+$/, ''),
            filename: uploadFile.name,
            blob_name: presignData.blob_name,
            file_type: uploadFile.name.split('.').pop()?.toLowerCase() || 'file',
            file_size_bytes: uploadFile.size,
            user_email: googleUser.email
          })
        });

        if (!confirmRes.ok) {
          const errData = await confirmRes.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to record uploaded resource.");
        }

        const confirmed = await confirmRes.json();
        setRawLectureResources(prev => [confirmed.resource, ...prev]);
        setCourseResources(prev => [confirmed.resource, ...prev]);
        setUploadModalOpen(false);

      } else {
        if (!uploadLinkUrl.trim()) {
          throw new Error("Please enter a valid URL.");
        }

        const linkRes = await fetch(`${API_BASE}/api/resources/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            course_name: uploadTarget.courseName || selectedCourse || 'General Lectures',
            video_id: uploadTarget.videoId || null,
            title: uploadTitle.trim() || uploadLinkUrl,
            link_url: uploadLinkUrl.trim(),
            user_email: googleUser.email
          })
        });

        if (!linkRes.ok) {
          const errData = await linkRes.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to save resource link.");
        }

        const linkData = await linkRes.json();
        setRawLectureResources(prev => [linkData.resource, ...prev]);
        setCourseResources(prev => [linkData.resource, ...prev]);
        setUploadModalOpen(false);
      }
    } catch (err) {
      console.error("Resource upload error:", err);
      setUploadError(err.message || "Failed to upload resource.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteResource = async (resourceId, videoId, courseName) => {
    if (!googleUser?.email) return;
    if (!window.confirm("Are you sure you want to delete this resource?")) return;

    try {
      const res = await fetch(`${API_BASE}/api/resources/${resourceId}?user_email=${encodeURIComponent(googleUser.email)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setRawLectureResources(prev => prev.filter(r => r.id !== resourceId));
        setCourseResources(prev => prev.filter(r => r.id !== resourceId));
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.detail || "Failed to delete resource.");
      }
    } catch (err) {
      console.error("Error deleting resource:", err);
    }
  };

  const [previewResource, setPreviewResource] = useState(null);

  const openPreviewModal = (resource) => {
    if (!resource) return;
    const resCopy = {
      ...resource,
      view_url: resource.view_url || resource.file_url || resource.download_url || '',
      download_url: resource.download_url || resource.view_url || resource.file_url || ''
    };
    const ft = (resCopy.file_type || resCopy.filename?.split('.').pop() || '').toLowerCase();
    if (ft === 'link' || ft === 'gdrive' || ft === 'drive' || ft === 'url') {
      const targetUrl = resCopy.view_url || resCopy.download_url;
      if (targetUrl) {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    setPreviewResource(resCopy);
  };

  const closePreviewModal = () => {
    setPreviewResource(null);
  };

  return {
    lectureResources,
    setLectureResources: setRawLectureResources,
    lectureResourcesLoading,
    courseResources,
    setCourseResources,
    courseResourcesLoading,
    courseViewTab,
    setCourseViewTab,
    uploadModalOpen,
    setUploadModalOpen,
    uploadTarget,
    uploadMode,
    setUploadMode,
    uploadFile,
    setUploadFile,
    uploadTitle,
    setUploadTitle,
    uploadLinkUrl,
    setUploadLinkUrl,
    isUploading,
    uploadError,
    setUploadError,
    openUploadModal,
    handleUploadResource,
    handleDeleteResource,
    previewResource,
    setPreviewResource,
    openPreviewModal,
    closePreviewModal
  };
}

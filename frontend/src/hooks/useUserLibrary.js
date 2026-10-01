import { useState, useMemo, useEffect } from 'react';
import { API_BASE } from '../utils/constants';
import { normalizeCourseSlug } from '../utils/routing';

export function useUserLibrary(userEmail) {
  const [userLibrary, setUserLibrary] = useState([]);
  const [userCourses, setUserCourses] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');

  const fetchUserLibrary = async (email = userEmail) => {
    if (!email) return;
    setLibraryLoading(true);
    try {
      const [libRes, coursesRes] = await Promise.all([
        fetch(`${API_BASE}/api/user/library?email=${encodeURIComponent(email)}`),
        fetch(`${API_BASE}/api/user/courses?email=${encodeURIComponent(email)}`)
      ]);
      if (libRes.ok) {
        const data = await libRes.json();
        setUserLibrary(data.lectures || data.library || []);
      }
      if (coursesRes.ok) {
        const cData = await coursesRes.json();
        setUserCourses(cData.courses || []);
      }
    } catch (err) {
      console.warn("Failed to fetch user library/courses:", err);
    } finally {
      setLibraryLoading(false);
    }
  };

  const handleDeleteFromLibrary = async (videoId) => {
    if (!videoId) return;
    try {
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/user/library/${videoId}${emailParam}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setUserLibrary(prev => prev.filter(item => item.video_id !== videoId));
      }
    } catch (err) {
      console.warn("Failed to delete from user library:", err);
    }
  };

  useEffect(() => {
    if (userEmail) {
      fetchUserLibrary(userEmail);
    } else {
      setUserLibrary([]);
      setUserCourses([]);
    }
  }, [userEmail]);

  const effectiveCourses = useMemo(() => {
    if (userCourses && userCourses.length > 0) {
      return userCourses;
    }
    const map = {};
    (userLibrary || []).forEach(item => {
      let cName = item.course_name;
      if (!cName) {
        const raw = (item.title || item.video_title || "General Lectures").trim();
        const withoutDate = raw.replace(/[\(\[\{]\s*\d{1,2}[\s/.\-]+\d{1,2}[\s/.\-]+\d{2,4}\s*[\)\]\}]/g, '');
        cName = withoutDate.replace(/\b(?:Live\s+Session|Session|Lecture|Module|Class|Week|Part|Episode)\b.*$/i, '').trim();
        cName = cName.replace(/[\s\-_:\|\/]+$/, '').trim();
        if (!cName || cName.length < 3) cName = raw;
      }

      const slug = normalizeCourseSlug(cName) || 'general';
      const isSlugFormat = cName === slug || (cName.includes('-') && cName === cName.toLowerCase());

      if (!map[slug]) {
        let displayTitle = cName;
        if (isSlugFormat) {
          const raw = (item.title || item.video_title || '').trim();
          const withoutDate = raw.replace(/[\(\[\{]\s*\d{1,2}[\s/.\-]+\d{1,2}[\s/.\-]+\d{2,4}\s*[\)\]\}]/g, '');
          const extracted = withoutDate.replace(/\b(?:Live\s+Session|Session|Lecture|Module|Class|Week|Part|Episode)\b.*$/i, '').trim().replace(/[\s\-_:\|\/]+$/, '');
          displayTitle = (extracted && extracted.length >= 3 && !extracted.includes('-')) 
            ? extracted 
            : cName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }

        map[slug] = {
          course_name: displayTitle,
          course_slug: slug,
          lecture_count: 0,
          latest_viewed_at: item.last_viewed_at || item.created_at,
          thumbnail_video_id: item.video_id,
          lectures: []
        };
      } else {
        if (map[slug].course_name.includes('-') && map[slug].course_name === map[slug].course_name.toLowerCase() && !isSlugFormat) {
          map[slug].course_name = cName;
        }
      }

      map[slug].lecture_count += 1;
      map[slug].lectures.push({
        ...item,
        course_name: map[slug].course_name
      });
    });
    return Object.values(map);
  }, [userCourses, userLibrary]);

  const filteredCourses = useMemo(() => {
    if (!librarySearch.trim()) return effectiveCourses;
    const q = librarySearch.toLowerCase();
    return effectiveCourses.filter(c => 
      c.course_name.toLowerCase().includes(q) ||
      (c.lectures && c.lectures.some(l => 
        (l.video_title && l.video_title.toLowerCase().includes(q)) ||
        (l.title && l.title.toLowerCase().includes(q)) ||
        (l.video_id && String(l.video_id).toLowerCase().includes(q))
      ))
    );
  }, [effectiveCourses, librarySearch]);

  const filteredLibrary = useMemo(() => {
    if (!librarySearch.trim()) return userLibrary;
    const q = librarySearch.toLowerCase();
    return userLibrary.filter(item => 
      (item.video_title && item.video_title.toLowerCase().includes(q)) ||
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.video_id && String(item.video_id).toLowerCase().includes(q))
    );
  }, [userLibrary, librarySearch]);

  return {
    userLibrary,
    setUserLibrary,
    userCourses,
    setUserCourses,
    libraryLoading,
    librarySearch,
    setLibrarySearch,
    fetchUserLibrary,
    handleDeleteFromLibrary,
    effectiveCourses,
    filteredCourses,
    filteredLibrary
  };
}

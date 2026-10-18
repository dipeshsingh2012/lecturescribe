import { useState, useMemo, useEffect, useRef } from 'react';
import { API_BASE } from '../utils/constants';
import { normalizeCourseSlug } from '../utils/routing';

export function useUserLibrary(userEmail) {
  const [userLibrary, setUserLibrary] = useState([]);
  const [userCourses, setUserCourses] = useState([]);
  const [pinnedCourses, setPinnedCourses] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const inFlightFetchRef = useRef(false);
  const lastFetchedEmailRef = useRef(null);

  const fetchUserLibrary = async (email = userEmail) => {
    if (!email) return;
    if (inFlightFetchRef.current && lastFetchedEmailRef.current === email) {
      return;
    }
    inFlightFetchRef.current = true;
    lastFetchedEmailRef.current = email;
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
        if (Array.isArray(cData.pinned_courses)) {
          setPinnedCourses(cData.pinned_courses);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch user library/courses:", err);
    } finally {
      inFlightFetchRef.current = false;
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
        setUserCourses(prev =>
          prev
            .map(c => {
              const filteredLectures = (c.lectures || []).filter(
                l => String(l.video_id || l.videoId || '') !== String(videoId)
              );
              return { ...c, lectures: filteredLectures, lecture_count: filteredLectures.length };
            })
            .filter(c => c.lecture_count > 0)
        );
      }
    } catch (err) {
      console.warn("Failed to delete from user library:", err);
    }
  };

  const handleDeleteCourse = async (courseName) => {
    if (!courseName) return false;
    try {
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      const targetSlug = normalizeCourseSlug(courseName);
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(courseName)}${emailParam}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const deletedVidSet = new Set((data.deleted_video_ids || []).map(String));
        setUserCourses(prev =>
          prev.filter(c => {
            const cSlug = normalizeCourseSlug(c.course_slug || c.course_name || '');
            return c.course_name !== courseName && cSlug !== targetSlug;
          })
        );
        setUserLibrary(prev =>
          prev.filter(item => {
            const itemVid = String(item.video_id || item.videoId || '');
            const itemSlug = normalizeCourseSlug(item.course_slug || item.course_name || '');
            return !deletedVidSet.has(itemVid) && item.course_name !== courseName && itemSlug !== targetSlug;
          })
        );
        setPinnedCourses(prev => prev.filter(slug => slug !== targetSlug));
        return true;
      }
    } catch (err) {
      console.warn("Failed to delete course:", err);
    }
    return false;
  };

  const handleTogglePin = async (courseIdentifier) => {
    if (!courseIdentifier) return false;
    const targetSlug = normalizeCourseSlug(courseIdentifier);

    // Optimistically update pinnedCourses with FIFO append semantics
    setPinnedCourses((prevPinned) => {
      if (prevPinned.includes(targetSlug)) {
        return prevPinned.filter((slug) => slug !== targetSlug);
      }
      return [...prevPinned, targetSlug];
    });

    if (!userEmail) return true;

    try {
      const res = await fetch(`${API_BASE}/api/user/courses/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          course_slug: targetSlug
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.pinned_courses)) {
          setPinnedCourses(data.pinned_courses);
        }
        return data.is_pinned;
      }
    } catch (err) {
      console.warn("Failed to toggle course pin on backend:", err);
    }
    return false;
  };

  useEffect(() => {
    if (userEmail) {
      fetchUserLibrary(userEmail);
    } else {
      setUserLibrary([]);
      setUserCourses([]);
      setPinnedCourses([]);
    }
  }, [userEmail]);

  const effectiveCourses = useMemo(() => {
    // Build lookup of lecture progress from userLibrary
    const libProgressMap = {};
    (userLibrary || []).forEach(it => {
      const vid = String(it.video_id || it.videoId || '');
      if (vid && it.progress) {
        libProgressMap[vid] = it.progress;
      }
    });

    if (userCourses && userCourses.length > 0) {
      return userCourses.map(course => {
        if (!course.lectures) return course;
        return {
          ...course,
          lectures: course.lectures.map(lec => {
            const vid = String(lec.video_id || lec.videoId || '');
            const prog = lec.progress || libProgressMap[vid];
            return prog ? { ...lec, progress: prog } : lec;
          })
        };
      });
    }
    const map = {};
    (userLibrary || []).forEach(item => {
      let cName = item.course_name;
      if (!cName) {
        const raw = (item.title || item.video_title || "").trim();
        const withoutDate = raw.replace(/[\(\[\{]\s*\d{1,2}[\s/.\-]+\d{1,2}[\s/.\-]+\d{2,4}\s*[\)\]\}]/g, '');
        cName = withoutDate.replace(/\b(?:Live\s+Session|Session|Lecture|Module|Class|Week|Part|Episode)\b.*$/i, '').trim();
        cName = cName.replace(/[\s\-_:\|\/]+$/, '').trim();
        if (!cName || cName.length < 3) cName = raw;
      }

      const slug = normalizeCourseSlug(cName);
      if (!cName || !slug) return;
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
    const list = effectiveCourses;
    const query = librarySearch.trim().toLowerCase();
    const matching = !query
      ? list
      : list.filter(c => 
          c.course_name.toLowerCase().includes(query) ||
          (c.lectures && c.lectures.some(l => 
            (l.video_title && l.video_title.toLowerCase().includes(query)) ||
            (l.title && l.title.toLowerCase().includes(query)) ||
            (l.video_id && String(l.video_id).toLowerCase().includes(query))
          ))
        );

    // If pinnedCourses list is tracked, sort pinned courses first in append order
    if (!pinnedCourses || pinnedCourses.length === 0) {
      return matching;
    }

    const pinnedSet = new Set(pinnedCourses);
    const pinned = [];
    pinnedCourses.forEach(slug => {
      const found = matching.find(c => normalizeCourseSlug(c.course_slug || c.course_name) === slug);
      if (found) {
        pinned.push({ ...found, is_pinned: true });
      }
    });

    const unpinned = matching
      .filter(c => {
        const slug = normalizeCourseSlug(c.course_slug || c.course_name);
        return !pinnedSet.has(slug);
      })
      .map(c => ({ ...c, is_pinned: Boolean(c.is_pinned && pinnedSet.has(normalizeCourseSlug(c.course_slug || c.course_name))) }));

    return [...pinned, ...unpinned];
  }, [effectiveCourses, pinnedCourses, librarySearch]);

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
    pinnedCourses,
    setPinnedCourses,
    handleTogglePin,
    libraryLoading,
    librarySearch,
    setLibrarySearch,
    fetchUserLibrary,
    handleDeleteFromLibrary,
    handleDeleteCourse,
    effectiveCourses,
    filteredCourses,
    filteredLibrary
  };
}

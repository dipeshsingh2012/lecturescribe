import { useState, useMemo, useEffect, useRef } from 'react';
import { API_BASE } from '../utils/constants';
import { normalizeCourseSlug, getCourseNameFromPath, coursesMatch, toCanonicalCourseName } from '../utils/routing';
import { filterAndSortLectures } from '../utils/lectureSort';

export function useCourseDetail(effectiveCourses, userEmail, librarySearch = '', activeData = null) {
  const [selectedCourse, setSelectedCourse] = useState(() => {
    try {
      const initial = typeof window !== 'undefined' ? window.location.pathname : '/';
      const raw = getCourseNameFromPath(initial);
      return toCanonicalCourseName(raw) || raw;
    } catch {
      return null;
    }
  });

  const [courseLoading, setCourseLoading] = useState(() => {
    try {
      const initial = typeof window !== 'undefined' ? window.location.pathname : '/';
      const cName = getCourseNameFromPath(initial);
      if (!cName) return false;
      const exists = (effectiveCourses || []).some(c => coursesMatch(c, cName));
      return !exists;
    } catch {
      return false;
    }
  });
  const [directCourseData, setDirectCourseData] = useState(null);
  const inFlightRef = useRef('');
  const lastFetchedRef = useRef('');

  // Direct course fetching when navigated to /course/:courseName directly
  useEffect(() => {
    if (!selectedCourse) {
      setDirectCourseData(null);
      setCourseLoading(false);
      return;
    }

    const alreadyInEffective = (effectiveCourses || []).some(c => 
      coursesMatch(c, selectedCourse)
    );

    const alreadyInDirect = directCourseData && coursesMatch(directCourseData, selectedCourse);

    if (alreadyInEffective || alreadyInDirect) {
      setCourseLoading(false);
      return;
    }

    const slug = normalizeCourseSlug(selectedCourse);
    const queryTarget = slug || selectedCourse;
    if (lastFetchedRef.current === queryTarget) {
      setCourseLoading(false);
      return;
    }
    if (inFlightRef.current === queryTarget) {
      return;
    }

    inFlightRef.current = queryTarget;
    setCourseLoading(true);

    const fetchDirectCourse = async () => {
      try {
        const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
        const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(queryTarget)}${emailParam}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.course) {
            lastFetchedRef.current = queryTarget;
            setDirectCourseData(data.course);
            if (data.course.course_name && data.course.course_name !== selectedCourse) {
              setSelectedCourse(data.course.course_name);
            }
          }
        }
      } catch (e) {
        console.warn("Direct course lookup error:", e);
      } finally {
        if (inFlightRef.current === queryTarget) {
          inFlightRef.current = '';
        }
        setCourseLoading(false);
      }
    };
    fetchDirectCourse();
  }, [selectedCourse, effectiveCourses, userEmail, directCourseData]);

  const refetchCourse = async (courseTarget = selectedCourse) => {
    const target = courseTarget || selectedCourse;
    if (!target) return null;
    const slug = normalizeCourseSlug(target);
    const queryTarget = slug || target;
    try {
      const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(queryTarget)}${emailParam}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.course) {
          lastFetchedRef.current = queryTarget;
          setDirectCourseData(prev => {
            const fetched = data.course;
            if (!prev || !prev.lectures || prev.lectures.length === 0) {
              return fetched;
            }
            const seen = new Set();
            const merged = [];
            for (const lec of (fetched.lectures || [])) {
              const id = String(lec.video_id || lec.videoId);
              if (!seen.has(id)) {
                seen.add(id);
                merged.push(lec);
              }
            }
            for (const lec of prev.lectures) {
              const id = String(lec.video_id || lec.videoId);
              if (!seen.has(id)) {
                seen.add(id);
                merged.push(lec);
              }
            }
            return {
              ...fetched,
              lecture_count: merged.length,
              lectures: merged
            };
          });
          return data.course;
        }
      }
    } catch (e) {
      console.warn("Direct course lookup error on refetch:", e);
    }
    return null;
  };

  const addLectureToCourse = (lecture, courseTarget = null) => {
    if (!lecture) return;
    const vidId = String(lecture.video_id || lecture.videoId);
    const resolvedName = (courseTarget || selectedCourse || lecture.course_name || '').trim();
    if (!resolvedName) return;
    setDirectCourseData(prev => {
      if (!prev) {
        return {
          course_name: resolvedName,
          course_slug: normalizeCourseSlug(resolvedName),
          lecture_count: 1,
          thumbnail_video_id: vidId,
          lectures: [lecture]
        };
      }
      const existing = prev.lectures || [];
      if (existing.some(l => String(l.video_id || l.videoId) === vidId)) {
        return prev;
      }
      const updated = [lecture, ...existing];
      return {
        ...prev,
        course_name: prev.course_name || resolvedName,
        course_slug: prev.course_slug || normalizeCourseSlug(resolvedName),
        lecture_count: updated.length,
        lectures: updated
      };
    });
  };

  const activeCourseData = useMemo(() => {
    if (!selectedCourse) return null;

    const fromDirect = (directCourseData && coursesMatch(directCourseData, selectedCourse)) ? directCourseData : null;

    const fromEffective = (effectiveCourses || []).find(c => coursesMatch(c, selectedCourse));

    if (fromDirect && fromEffective) {
      const seen = new Map();
      for (const lec of (fromDirect.lectures || [])) {
        const id = String(lec.video_id || lec.videoId);
        seen.set(id, lec);
      }
      for (const lec of (fromEffective.lectures || [])) {
        const id = String(lec.video_id || lec.videoId);
        if (seen.has(id)) {
          const existing = seen.get(id);
          seen.set(id, {
            ...existing,
            ...lec,
            progress: lec.progress || existing.progress
          });
        } else {
          seen.set(id, lec);
        }
      }
      const merged = Array.from(seen.values());
      return {
        ...fromDirect,
        lecture_count: merged.length,
        lectures: merged
      };
    }

    if (fromDirect) return fromDirect;
    if (fromEffective) return fromEffective;

    return null;
  }, [effectiveCourses, selectedCourse, directCourseData]);

  // Automatically upgrade selectedCourse from a URL slug or alias to its human-readable title
  useEffect(() => {
    if (activeCourseData?.course_name && selectedCourse !== activeCourseData.course_name) {
      if (coursesMatch(selectedCourse, activeCourseData.course_name)) {
        setSelectedCourse(activeCourseData.course_name);
      }
    }
  }, [activeCourseData, selectedCourse]);

  const [lectureSortBy, setLectureSortBy] = useState('title_desc');
  const [lectureStatusFilter, setLectureStatusFilter] = useState('all');

  const filteredCourseLectures = useMemo(() => {
    if (!activeCourseData || !Array.isArray(activeCourseData.lectures)) return [];
    return filterAndSortLectures(activeCourseData.lectures, {
      search: librarySearch,
      status: lectureStatusFilter,
      sortBy: lectureSortBy
    });
  }, [activeCourseData, librarySearch, lectureStatusFilter, lectureSortBy]);

  // Synchronize document title with currently active lecture or course route
  useEffect(() => {
    const canonicalCourse = activeCourseData?.course_name || activeData?.course_name || selectedCourse;
    if (activeData?.title) {
      document.title = `${activeData.title} | LectureScribe`;
    } else if (canonicalCourse) {
      document.title = `${canonicalCourse} | Course | LectureScribe`;
    } else {
      document.title = 'LectureScribe - LMS & Lecture AI Workspace';
    }
  }, [activeData, selectedCourse, activeCourseData]);

  return {
    selectedCourse,
    setSelectedCourse,
    courseLoading,
    directCourseData,
    setDirectCourseData,
    activeCourseData,
    filteredCourseLectures,
    refetchCourse,
    addLectureToCourse,
    lectureSortBy,
    setLectureSortBy,
    lectureStatusFilter,
    setLectureStatusFilter,
    sortBy: lectureSortBy,
    setSortBy: setLectureSortBy,
    statusFilter: lectureStatusFilter,
    setStatusFilter: setLectureStatusFilter
  };
}

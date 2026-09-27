import { useState, useMemo, useEffect } from 'react';
import { API_BASE } from '../utils/constants';
import { normalizeCourseSlug, getCourseNameFromPath } from '../utils/routing';

export function useCourseDetail(effectiveCourses, userEmail, librarySearch = '', activeData = null) {
  const [selectedCourse, setSelectedCourse] = useState(() => {
    try {
      const initial = typeof window !== 'undefined' ? window.location.pathname : '/';
      return getCourseNameFromPath(initial);
    } catch {
      return null;
    }
  });

  const [courseLoading, setCourseLoading] = useState(false);
  const [directCourseData, setDirectCourseData] = useState(null);

  // Direct course fetching when navigated to /course/:courseName directly
  useEffect(() => {
    if (!selectedCourse) {
      setDirectCourseData(null);
      return;
    }
    const clean = selectedCourse.trim().toLowerCase();
    const slug = normalizeCourseSlug(selectedCourse);
    const alreadyFound = effectiveCourses.some(c => 
      c.course_name === selectedCourse || 
      c.course_name.toLowerCase() === clean ||
      normalizeCourseSlug(c.course_name) === slug
    );
    if (alreadyFound) return;

    let isMounted = true;
    const fetchDirectCourse = async () => {
      setCourseLoading(true);
      try {
        const emailParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
        const res = await fetch(`${API_BASE}/api/course/${encodeURIComponent(selectedCourse)}${emailParam}`);
        if (res.ok && isMounted) {
          const data = await res.json();
          if (data.course) {
            setDirectCourseData(data.course);
          }
        }
      } catch (e) {
        console.warn("Direct course lookup error:", e);
      } finally {
        if (isMounted) setCourseLoading(false);
      }
    };
    fetchDirectCourse();
    return () => { isMounted = false; };
  }, [selectedCourse, effectiveCourses, userEmail]);

  const activeCourseData = useMemo(() => {
    if (!selectedCourse) return null;
    const clean = selectedCourse.trim().toLowerCase();
    const slug = normalizeCourseSlug(selectedCourse);
    const found = (
      effectiveCourses.find(c => c.course_name === selectedCourse) ||
      effectiveCourses.find(c => c.course_name.toLowerCase() === clean) ||
      effectiveCourses.find(c => normalizeCourseSlug(c.course_name) === slug)
    );
    if (found) return found;
    if (directCourseData && (
      directCourseData.course_name === selectedCourse ||
      directCourseData.course_name.toLowerCase() === clean ||
      normalizeCourseSlug(directCourseData.course_name) === slug
    )) {
      return directCourseData;
    }
    return null;
  }, [effectiveCourses, selectedCourse, directCourseData]);

  // Automatically upgrade selectedCourse from a URL slug to its human-readable title
  useEffect(() => {
    if (activeCourseData?.course_name && selectedCourse) {
      if (selectedCourse !== activeCourseData.course_name && normalizeCourseSlug(selectedCourse) === normalizeCourseSlug(activeCourseData.course_name)) {
        setSelectedCourse(activeCourseData.course_name);
      }
    }
  }, [activeCourseData, selectedCourse]);

  const filteredCourseLectures = useMemo(() => {
    if (!activeCourseData) return [];
    if (!librarySearch.trim()) return activeCourseData.lectures;
    const q = librarySearch.toLowerCase();
    return activeCourseData.lectures.filter(item => 
      (item.video_title && item.video_title.toLowerCase().includes(q)) ||
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.video_id && String(item.video_id).toLowerCase().includes(q))
    );
  }, [activeCourseData, librarySearch]);

  // Synchronize document title with currently active lecture or course route
  useEffect(() => {
    const courseTitle = activeCourseData?.course_name || selectedCourse;
    if (activeData?.title) {
      document.title = `${activeData.title} | LectureScribe`;
    } else if (courseTitle) {
      document.title = `${courseTitle} | Course | LectureScribe`;
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
    filteredCourseLectures
  };
}

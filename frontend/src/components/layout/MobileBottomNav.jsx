import React, { useState } from 'react';
import {
  Box,
  Drawer,
  Typography,
  IconButton,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Badge
} from '@mui/material';
import {
  Layers,
  Video,
  Bot,
  BarChart3,
  MoreHorizontal,
  Home,
  Calendar as CalendarIcon,
  PlusCircle,
  Award,
  BookOpen,
  MessageSquare,
  Users,
  Target,
  Megaphone,
  FileCode,
  Database,
  Activity,
  X
} from 'lucide-react';

export default function MobileBottomNav({
  selectedCourse,
  courseViewTab = 'lectures',
  setCourseViewTab = () => {},
  isCalendarPage = false,
  onNavigateHome = () => {},
  onNavigateCalendar = () => {},
  isTutor = false,
  onCreateNewNote = null,
  currentTheme
}) {
  const [moreDrawerOpen, setMoreDrawerOpen] = useState(false);

  const palette = currentTheme?.palette || {
    primary: '#0075ED',
    headerBg: '#022758',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    textPrimary: '#0f172a',
    textSecondary: '#64748b'
  };

  // If user is inside a course view
  if (selectedCourse) {
    const primaryTabs = [
      { id: 'syllabus', label: 'Syllabus', icon: Layers },
      { id: 'lectures', label: 'Lectures', icon: Video },
      { id: 'tutor', label: 'AI Tutor', icon: Bot },
      { id: 'grades', label: 'Grades', icon: BarChart3 }
    ];

    const isPrimaryActive = primaryTabs.some((t) => t.id === courseViewTab);

    const studyTools = [
      { id: 'quiz', label: 'Course Quiz & Exam', desc: 'Comprehensive practice exam', icon: Award },
      { id: 'summary', label: 'Course Summary', desc: 'AI synthesis across lectures', icon: BookOpen },
      { id: 'library', label: 'Library & Scratchpad', desc: 'Slides, readings, and notes', icon: BookOpen },
      { id: 'calendar', label: 'Course Calendar', desc: 'Deadlines & exam timeline', icon: CalendarIcon }
    ];

    const collabTools = [
      { id: 'forum', label: 'Course Discussions & Q&A', desc: 'Timestamp deep-links & AI TA', icon: MessageSquare },
      { id: 'participants', label: 'Participants & Roster', desc: 'Enrolled students and keys', icon: Users },
      { id: 'rubrics', label: 'Rubrics & Outcomes', desc: '2D grading & skill matrix', icon: Target },
      { id: 'workshops', label: 'Workshops & Broadcasts', desc: 'Peer review & announcements', icon: Megaphone }
    ];

    const tutorTools = [
      { id: 'assignments', label: 'Assignments & SpeedGrader', desc: 'PDF problem sets & AI grading', icon: FileCode },
      { id: 'question-bank', label: 'Question Bank', desc: 'Bloom taxonomy & custom quizzes', icon: Database },
      { id: 'analytics', label: 'Learning Analytics', desc: 'At-risk telemetry & AI outreach', icon: Activity }
    ];

    const handleSelectSecondaryTab = (tabId) => {
      setCourseViewTab(tabId);
      setMoreDrawerOpen(false);
    };

    return (
      <>
        <nav
          className="mobile-bottom-nav"
          role="navigation"
          aria-label="Course Bottom Navigation"
          style={{ background: palette.cardBg, borderTopColor: palette.cardBorder }}
        >
          {primaryTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = courseViewTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`mobile-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setCourseViewTab(tab.id)}
                aria-label={tab.label}
                aria-current={isActive ? 'page' : undefined}
                style={{ color: isActive ? palette.primary : palette.textSecondary }}
              >
                <Icon size={20} strokeWidth={isActive ? 2.4 : 1.8} />
                <span>{tab.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            className={`mobile-nav-item ${!isPrimaryActive ? 'active' : ''}`}
            onClick={() => setMoreDrawerOpen(true)}
            aria-label="More Course Tools"
            aria-haspopup="dialog"
            aria-expanded={moreDrawerOpen}
            style={{ color: !isPrimaryActive ? palette.primary : palette.textSecondary }}
          >
            <Badge
              variant="dot"
              invisible={isPrimaryActive}
              sx={{ '& .MuiBadge-badge': { bgcolor: palette.primary } }}
            >
              <MoreHorizontal size={20} strokeWidth={!isPrimaryActive ? 2.4 : 1.8} />
            </Badge>
            <span>More</span>
          </button>
        </nav>

        {/* More Tools Slide-Up Bottom Sheet Drawer */}
        <Drawer
          anchor="bottom"
          open={moreDrawerOpen}
          onClose={() => setMoreDrawerOpen(false)}
          slotProps={{
            paper: {
              sx: {
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                bgcolor: palette.cardBg,
                color: palette.textPrimary,
                maxHeight: '80vh',
                pb: 'calc(var(--safe-bottom) + 16px)'
              }
            }
          }}
        >
          <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${palette.cardBorder}` }}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, color: palette.textPrimary }}>
                Course Modules & Tools
              </Typography>
              <Typography variant="caption" sx={{ color: palette.textSecondary }}>
                Tap any tool to open in {selectedCourse}
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setMoreDrawerOpen(false)} aria-label="Close menu">
              <X size={18} />
            </IconButton>
          </Box>

          <Box sx={{ overflowY: 'auto', p: 1.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 800, color: palette.textSecondary, px: 1, py: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Study & Assessment
            </Typography>
            <List dense disablePadding sx={{ mb: 1.5 }}>
              {studyTools.map((item) => {
                const Icon = item.icon;
                const isSelected = courseViewTab === item.id;
                return (
                  <ListItemButton
                    key={item.id}
                    onClick={() => handleSelectSecondaryTab(item.id)}
                    sx={{
                      borderRadius: 2,
                      mb: 0.5,
                      bgcolor: isSelected ? 'var(--highlight-bg)' : 'transparent',
                      color: isSelected ? palette.primary : palette.textPrimary
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36, color: isSelected ? palette.primary : palette.textSecondary }}>
                      <Icon size={18} />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography sx={{ fontWeight: isSelected ? 800 : 600, fontSize: '0.85rem' }}>
                          {item.label}
                        </Typography>
                      }
                      secondary={
                        <Typography sx={{ fontSize: '0.72rem', color: palette.textSecondary }}>
                          {item.desc}
                        </Typography>
                      }
                    />
                  </ListItemButton>
                );
              })}
            </List>

            <Divider sx={{ my: 1, borderColor: palette.cardBorder }} />

            <Typography variant="caption" sx={{ fontWeight: 800, color: palette.textSecondary, px: 1, py: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Community & Mastery
            </Typography>
            <List dense disablePadding sx={{ mb: 1.5 }}>
              {collabTools.map((item) => {
                const Icon = item.icon;
                const isSelected = courseViewTab === item.id;
                return (
                  <ListItemButton
                    key={item.id}
                    onClick={() => handleSelectSecondaryTab(item.id)}
                    sx={{
                      borderRadius: 2,
                      mb: 0.5,
                      bgcolor: isSelected ? 'var(--highlight-bg)' : 'transparent',
                      color: isSelected ? palette.primary : palette.textPrimary
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36, color: isSelected ? palette.primary : palette.textSecondary }}>
                      <Icon size={18} />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography sx={{ fontWeight: isSelected ? 800 : 600, fontSize: '0.85rem' }}>
                          {item.label}
                        </Typography>
                      }
                      secondary={
                        <Typography sx={{ fontSize: '0.72rem', color: palette.textSecondary }}>
                          {item.desc}
                        </Typography>
                      }
                    />
                  </ListItemButton>
                );
              })}
            </List>

            {isTutor && (
              <>
                <Divider sx={{ my: 1, borderColor: palette.cardBorder }} />
                <Typography variant="caption" sx={{ fontWeight: 800, color: '#10b981', px: 1, py: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Instructor Tools (Tutor Only)
                </Typography>
                <List dense disablePadding>
                  {tutorTools.map((item) => {
                    const Icon = item.icon;
                    const isSelected = courseViewTab === item.id;
                    return (
                      <ListItemButton
                        key={item.id}
                        onClick={() => handleSelectSecondaryTab(item.id)}
                        sx={{
                          borderRadius: 2,
                          mb: 0.5,
                          bgcolor: isSelected ? 'var(--highlight-bg)' : 'transparent',
                          color: isSelected ? palette.primary : palette.textPrimary
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 36, color: isSelected ? palette.primary : '#10b981' }}>
                          <Icon size={18} />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Typography sx={{ fontWeight: isSelected ? 800 : 600, fontSize: '0.85rem' }}>
                              {item.label}
                            </Typography>
                          }
                          secondary={
                            <Typography sx={{ fontSize: '0.72rem', color: palette.textSecondary }}>
                              {item.desc}
                            </Typography>
                          }
                        />
                      </ListItemButton>
                    );
                  })}
                </List>
              </>
            )}
          </Box>
        </Drawer>
      </>
    );
  }

  // Global Hub Navigation (Home, Calendar, New Note)
  return (
    <nav
      className="mobile-bottom-nav"
      role="navigation"
      aria-label="Global Mobile Navigation"
      style={{ background: palette.cardBg, borderTopColor: palette.cardBorder }}
    >
      <button
        type="button"
        className={`mobile-nav-item ${!isCalendarPage ? 'active' : ''}`}
        onClick={onNavigateHome}
        aria-label="Courses Hub"
        aria-current={!isCalendarPage ? 'page' : undefined}
        style={{ color: !isCalendarPage ? palette.primary : palette.textSecondary }}
      >
        <Home size={20} strokeWidth={!isCalendarPage ? 2.4 : 1.8} />
        <span>Courses</span>
      </button>

      <button
        type="button"
        className={`mobile-nav-item ${isCalendarPage ? 'active' : ''}`}
        onClick={onNavigateCalendar}
        aria-label="Academic Calendar"
        aria-current={isCalendarPage ? 'page' : undefined}
        style={{ color: isCalendarPage ? palette.primary : palette.textSecondary }}
      >
        <CalendarIcon size={20} strokeWidth={isCalendarPage ? 2.4 : 1.8} />
        <span>Calendar</span>
      </button>

      {typeof onCreateNewNote === 'function' && (
        <button
          type="button"
          className="mobile-nav-item"
          onClick={onCreateNewNote}
          aria-label="New Note"
          style={{ color: palette.textSecondary }}
        >
          <PlusCircle size={20} strokeWidth={1.8} />
          <span>New Note</span>
        </button>
      )}
    </nav>
  );
}

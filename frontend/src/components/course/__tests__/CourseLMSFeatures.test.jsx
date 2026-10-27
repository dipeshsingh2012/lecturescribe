import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CourseAssignments from '../CourseAssignments';
import CourseGrades from '../CourseGrades';
import CourseParticipants from '../CourseParticipants';
import CourseForum from '../CourseForum';
import CourseSyllabusSpine from '../CourseSyllabusSpine';
import CourseQuestionBank from '../CourseQuestionBank';
import CourseAnalytics from '../CourseAnalytics';
import CourseRubricsAndCompetencies from '../CourseRubricsAndCompetencies';
import CourseWorkshopsAndAnnouncements from '../CourseWorkshopsAndAnnouncements';

const mockTheme = {
  palette: {
    primary: '#3b82f6',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    textPrimary: '#0f172a',
    textSecondary: '#64748b'
  }
};

describe('LMS Options 1–4 Frontend Components', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Option 1: CourseAssignments renders deadline publishing and AI SpeedGrader drawer', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        submissions: [
          {
            submission_id: 'sub_01',
            assignment_id: 'asgn_01',
            student_email: 'alice@student.iiitdwd.ac.in',
            student_name: 'Alice Verma',
            submission_text: 'theta_hat = (X^T X)^-1 X^T y',
            status: 'submitted',
            max_marks: 50,
            ai_suggested_score: 46,
            ai_feedback: 'Rigorous matrix derivation.'
          }
        ]
      })
    });

    render(
      <CourseAssignments
        courseName="Statistical Inference"
        assignments={[
          {
            assignment_id: 'asgn_01',
            title: 'OLS & MLE Problem Set',
            source_filename: 'pset1.pdf',
            status: 'completed',
            due_date: '2026-11-20T23:59:00',
            max_marks: 50
          }
        ]}
        isTutor={true}
        userEmail="prof@iiitdwd.ac.in"
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Publish & Sync Calendar')).toBeInTheDocument();
    const graderBtn = screen.getByRole('button', { name: /Submissions & AI SpeedGrader/i });
    fireEvent.click(graderBtn);

    expect(await screen.findByText(/Alice Verma/i)).toBeInTheDocument();
    expect(screen.getByText(/Rigorous matrix derivation/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^AI SpeedGrade$/i })).toBeInTheDocument();
  });

  it('Option 2: CourseGrades renders Tutor Class Matrix and Student Grade Report', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/gradebook')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            course_name: 'Statistical Inference',
            course_slug: 'statistical-inference',
            columns: [
              { item_id: 'asgn_01', title: 'MLE Homework', item_type: 'assignment', max_marks: 50 }
            ],
            students: [
              {
                student_email: 'alice@student.iiitdwd.ac.in',
                student_name: 'Alice Verma',
                grades: {
                  asgn_01: { score: 48, max_marks: 50, status: 'graded', percentage: 96.0, feedback: 'Great work' }
                },
                total_earned: 48,
                total_possible: 50,
                overall_percentage: 96.0,
                letter_grade: 'A+'
              }
            ],
            summary: {
              student_count: 1,
              assessment_count: 1,
              class_average_percentage: 96.0,
              highest_percentage: 96.0
            }
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ assignments: [] }) });
    });

    const { rerender } = render(
      <CourseGrades
        courseName="Statistical Inference"
        isTutor={true}
        userEmail="prof@iiitdwd.ac.in"
        currentTheme={mockTheme}
      />
    );

    expect(await screen.findByText('Alice Verma')).toBeInTheDocument();
    expect(screen.getByText('Export Gradebook CSV')).toBeInTheDocument();
    expect(screen.getByText('A+')).toBeInTheDocument();

    rerender(
      <CourseGrades
        courseName="Statistical Inference"
        isTutor={false}
        userEmail="alice@student.iiitdwd.ac.in"
        currentTheme={mockTheme}
      />
    );

    expect((await screen.findAllByText('MLE Homework')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Great work')).length).toBeGreaterThan(0);
  });

  it('Option 3: CourseParticipants renders Enrollment Key and Roster', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/enrollment-key')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            key_record: { enrollment_key: 'STAT-2026', course_slug: 'statistical-inference' }
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          members: [
            { user_email: 'prof@iiitdwd.ac.in', name: 'Prof Sharma', course_role: 'tutor', enrol_method: 'manual' },
            { user_email: 'alice@student.iiitdwd.ac.in', name: 'Alice Verma', course_role: 'student', enrol_method: 'self_key' }
          ]
        })
      });
    });

    render(
      <CourseParticipants
        courseName="Statistical Inference"
        isTutor={true}
        userEmail="prof@iiitdwd.ac.in"
        currentTheme={mockTheme}
      />
    );

    expect(await screen.findByText('STAT-2026')).toBeInTheDocument();
    expect(screen.getByText('Prof Sharma')).toBeInTheDocument();
    expect(screen.getByText('Alice Verma')).toBeInTheDocument();
  });

  it('Option 4: CourseForum renders timestamp deep-links, AI TA replies, and endorsement badge', async () => {
    const onJump = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        threads: [
          {
            thread_id: 'thr_01',
            title: 'Fisher Information Regularity Condition',
            body: 'Question about interchanging derivative and integral at [14:20].',
            category: 'lecture_question',
            author_email: 'alice@student.iiitdwd.ac.in',
            author_name: 'Alice Verma',
            author_role: 'student',
            video_id: 'vid_04',
            lecture_title: 'Lecture 4: Fisher Info',
            timestamp_str: '14:20',
            is_pinned: false,
            is_resolved: true,
            replies: [
              {
                reply_id: 'rep_01',
                thread_id: 'thr_01',
                author_name: 'LectureScribe AI TA',
                body: 'The support of the distribution must not depend on theta.',
                is_ai_generated: true,
                is_instructor_endorsed: true
              }
            ]
          }
        ]
      })
    });

    render(
      <CourseForum
        courseName="Statistical Inference"
        isTutor={true}
        userEmail="prof@iiitdwd.ac.in"
        onJumpToLecture={onJump}
        currentTheme={mockTheme}
      />
    );

    expect(await screen.findByText('Fisher Information Regularity Condition')).toBeInTheDocument();
    expect(screen.getByText('AI TA Grounded Reply')).toBeInTheDocument();
    expect(screen.getByText('Instructor Endorsed')).toBeInTheDocument();

    const tsChip = screen.getByText(/Lecture 4: Fisher Info @ 14:20/i);
    fireEvent.click(tsChip);
    expect(onJump).toHaveBeenCalledWith('vid_04', '14:20');
  });

  it('Wave 2 Options 1 & 3: CourseSyllabusSpine renders completion progress, prerequisite locks, and weekly modules', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/syllabus')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sections: [
              {
                section_id: 'sec_w1',
                section_number: 1,
                title: 'Week 1: Point Estimation & MLE',
                summary: 'Foundations of maximum likelihood.',
                learning_objectives: ['Derive the score function and Fisher information'],
                items: [
                  { item_id: 'vid_01', item_type: 'lecture', title: 'Lecture 1: MLE', video_id: 'vid_01' }
                ]
              }
            ]
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          course_name: 'Statistical Inference',
          completed_count: 1,
          total_count: 2,
          completion_percentage: 50.0,
          modules: [
            {
              module_id: 'vid_01',
              module_type: 'lecture',
              title: 'Lecture 1: MLE',
              is_completed: true,
              is_locked: false,
              lock_reasons: []
            },
            {
              module_id: 'quiz_best_statistical-inference',
              module_type: 'quiz',
              title: 'Course Comprehensive AI Exam',
              is_completed: false,
              is_locked: true,
              lock_reasons: ['Complete prerequisite: Lecture 2: Sufficiency']
            }
          ]
        })
      });
    });

    render(
      <CourseSyllabusSpine
        courseName="Statistical Inference"
        isTutor={true}
        userEmail="prof@iiitdwd.ac.in"
        currentTheme={mockTheme}
      />
    );

    expect(await screen.findByText('Week 1: Point Estimation & MLE')).toBeInTheDocument();
    expect(screen.getByText(/50% Complete/i)).toBeInTheDocument();
    expect(screen.getByText(/Locked: Complete prerequisite: Lecture 2: Sufficiency/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI Auto-Organize Weekly Syllabus/i })).toBeInTheDocument();
  });

  it('Wave 2 Option 2: CourseQuestionBank renders Bloom-tagged items and publishes custom quiz', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        questions: [
          {
            question_id: 'qb_101',
            question_text: 'Which condition guarantees asymptotic normality of the MLE?',
            options: ['Regularity & non-singular Fisher Info', 'Zero sample size'],
            correct_answer: '0',
            explanation: 'Cramer-Rao regularity conditions.',
            difficulty: 'hard',
            bloom_level: 'analyze',
            lecture_title: 'Lecture 3: CRLB',
            timestamp_str: '08:15'
          }
        ]
      })
    });

    render(
      <CourseQuestionBank
        courseName="Statistical Inference"
        isTutor={true}
        userEmail="prof@iiitdwd.ac.in"
        currentTheme={mockTheme}
      />
    );

    expect(await screen.findByText(/Which condition guarantees asymptotic normality of the MLE\?/i)).toBeInTheDocument();
    expect(screen.getByText('Bloom: ANALYZE')).toBeInTheDocument();
    expect(screen.getByText('Difficulty: HARD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Publish to Course Quiz/i })).toBeInTheDocument();
  });

  it('Wave 2 Option 4: CourseAnalytics renders KPI cards, risk status, and AI Early-Warning outreach', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: {
          total_students: 2,
          at_risk_high_count: 1,
          at_risk_medium_count: 0,
          on_track_count: 1,
          avg_engagement_score: 58.5,
          avg_completion_percentage: 55.0,
          total_forum_posts: 3
        },
        students: [
          {
            student_email: 'bob@student.iiitdwd.ac.in',
            student_name: 'Bob Sharma',
            completion_percentage: 20.0,
            overall_grade_percentage: 42.0,
            letter_grade: 'F',
            assignments_submitted: 0,
            assignments_total: 2,
            forum_posts: 0,
            engagement_score: 25.8,
            risk_level: 'high',
            risk_factors: ['Low module completion (20.0%)', 'Missing assignments (0/2 submitted)'],
            ai_intervention_message: 'Hi Bob Sharma, our LectureScribe learning copilot noticed your current progress is at 20.0%.'
          }
        ]
      })
    });

    render(
      <CourseAnalytics
        courseName="Statistical Inference"
        currentTheme={mockTheme}
      />
    );

    expect(await screen.findByText('Bob Sharma')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByText(/Low module completion \(20.0%\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy AI Outreach/i })).toBeInTheDocument();
  });

  it('Wave 3 Options 1 & 2: CourseRubricsAndCompetencies renders 2D Rubric matrix and Course Competency Mastery Matrix', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/rubrics')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            rubrics: [
              {
                rubric_id: 'rub_01',
                title: '2D Rubric: MLE Homework',
                total_points: 50,
                criteria: [
                  {
                    criterion_id: 'crit_1',
                    title: 'Mathematical Formulation',
                    max_points: 25,
                    levels: [
                      { label: 'Exemplary', points: 25, description: 'Complete derivation' },
                      { label: 'Developing', points: 10, description: 'Partial setup' }
                    ]
                  }
                ]
              }
            ]
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          competencies: [
            { competency_id: 'comp_1', code: 'CLO-1', title: 'Asymptotic Theory & MLE', description: 'Derive Fisher Info' }
          ],
          students: [
            {
              student_email: 'alice@student.iiitdwd.ac.in',
              student_name: 'Alice Verma',
              competencies: {
                comp_1: { competency_id: 'comp_1', code: 'CLO-1', score_percentage: 94.0, mastery_level: 'Mastered' }
              }
            }
          ]
        })
      });
    });

    render(
      <CourseRubricsAndCompetencies
        courseName="Statistical Inference"
        isTutor={true}
        userEmail="prof@iiitdwd.ac.in"
        currentTheme={mockTheme}
      />
    );

    expect(await screen.findByText('2D Rubric: MLE Homework')).toBeInTheDocument();
    expect(screen.getByText('Mathematical Formulation')).toBeInTheDocument();
    expect(screen.getByText('Asymptotic Theory & MLE')).toBeInTheDocument();
    expect(screen.getByText(/Mastered \(94%\)/i)).toBeInTheDocument();
  });

  it('Wave 3 Options 3 & 4: CourseWorkshopsAndAnnouncements renders broadcasts, audit logs, and peer review calibration', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/announcements')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            announcements: [
              {
                announcement_id: 'ann_01',
                title: 'Midterm Room Change',
                body: 'Moved to Lecture Hall 2.',
                priority: 'urgent',
                author_name: 'Prof Sharma'
              }
            ],
            audit_logs: [
              {
                log_id: 'evt_01',
                actor_email: 'prof@iiitdwd.ac.in',
                verb: 'broadcasted_announcement',
                summary: 'Broadcasted [URGENT] announcement: Midterm Room Change'
              }
            ]
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          workshops: [
            {
              workshop_id: 'ws_01',
              title: 'Peer Review: CRLB Proof',
              instructions: 'Evaluate peer derivations.',
              phase: 'assessment',
              submissions: [
                {
                  submission_id: 'wssub_01',
                  student_name: 'Alice Verma',
                  title: 'CRLB Matrix Proof',
                  content: 'Using Cauchy-Schwarz on the score vector...',
                  avg_peer_score: 95.0,
                  reviews: [
                    {
                      review_id: 'wsrev_01',
                      reviewer_name: 'Karan Mehta',
                      peer_score: 95.0,
                      feedback: 'Rigorous proof with clear regularity conditions.',
                      ai_calibration_score: 95.0
                    }
                  ]
                }
              ]
            }
          ]
        })
      });
    });

    render(
      <CourseWorkshopsAndAnnouncements
        courseName="Statistical Inference"
        isTutor={true}
        userEmail="prof@iiitdwd.ac.in"
        currentTheme={mockTheme}
      />
    );

    expect(await screen.findByText('Midterm Room Change')).toBeInTheDocument();
    expect(screen.getByText(/Broadcasted \[URGENT\] announcement/i)).toBeInTheDocument();
    expect(screen.getByText('Peer Review: CRLB Proof')).toBeInTheDocument();
    expect(screen.getByText('AI Calibration: 95%')).toBeInTheDocument();
  });
});

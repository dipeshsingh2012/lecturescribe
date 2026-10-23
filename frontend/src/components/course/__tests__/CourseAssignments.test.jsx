import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CourseAssignments from '../CourseAssignments';

describe('CourseAssignments Component', () => {
  const mockUpload = vi.fn();
  const mockDelete = vi.fn();

  const mockTheme = {
    palette: {
      primary: '#3b82f6',
      cardBg: '#ffffff',
      cardBorder: '#e2e8f0',
      textPrimary: '#0f172a',
      textSecondary: '#64748b'
    }
  };

  const sampleAssignments = [
    {
      assignment_id: 'asgn_123',
      title: 'Linear Regression Assignment',
      source_filename: 'homework1.pdf',
      status: 'completed',
      created_at: '2026-10-23T00:00:00Z',
      questions_summary: [
        {
          question_number: 1,
          title: 'Normal Equation',
          question_text: 'Derive theta = (X^T X)^-1 X^T y',
          course_references: [
            {
              lecture_title: 'Lecture 3: Regression',
              timestamp: '14:20',
              snippet: 'The normal equation gives exact closed form solution.'
            }
          ]
        }
      ]
    }
  ];

  it('renders the empty state when no assignments exist', () => {
    render(
      <CourseAssignments
        courseName="CS 101"
        assignments={[]}
        onUploadAssignment={mockUpload}
        onDeleteAssignment={mockDelete}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/No assignments added yet/i)).toBeInTheDocument();
    expect(screen.getByText(/CS 101 • Assignment Planner/i)).toBeInTheDocument();
  });

  it('renders completed assignments with download buttons', () => {
    render(
      <CourseAssignments
        courseName="CS 101"
        assignments={sampleAssignments}
        onUploadAssignment={mockUpload}
        onDeleteAssignment={mockDelete}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Linear Regression Assignment')).toBeInTheDocument();
    expect(screen.getByText(/Download \.ipynb/i)).toBeInTheDocument();
    expect(screen.getByText(/Download Solution PDF/i)).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });
});


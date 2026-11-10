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

  it('renders assignments awaiting approval with co-pilot analysis and handles approval', () => {
    const mockApprove = vi.fn();
    const awaitingAssignments = [
      {
        assignment_id: 'asgn_await_999',
        title: 'Deep Learning Optimization',
        source_filename: 'homework2.pdf',
        status: 'awaiting_approval',
        raw_extracted_text: 'Question 1: Compute gradients for Cross Entropy Loss.\nQuestion 2: Implement Adam optimizer.',
        created_at: '2026-10-24T00:00:00Z',
        questions_summary: [
          {
            question_number: 1,
            title: 'Gradient Derivation',
            question_text: 'Compute gradients for Cross Entropy Loss.',
            estimated_difficulty: 'hard'
          }
        ],
        citations: [
          {
            lecture_title: 'Lecture 5: Backprop',
            timestamp: '22:15',
            snippet: 'Derivative of cross-entropy with respect to logits.'
          }
        ]
      }
    ];

    render(
      <CourseAssignments
        courseName="CS 101"
        assignments={awaitingAssignments}
        onUploadAssignment={mockUpload}
        onApproveAssignment={mockApprove}
        onDeleteAssignment={mockDelete}
        currentTheme={mockTheme}
      />
    );

    // Verify glass-box analysis elements
    expect(screen.getByText(/Analysis Ready • Awaiting Your Go-Ahead/i)).toBeInTheDocument();
    expect(screen.getByText(/Co-Pilot Analysis & Plan Ready/i)).toBeInTheDocument();
    expect(screen.getByText('Approve & Execute Lab Notebook')).toBeInTheDocument();

    // Click Approve & Execute
    const approveBtn = screen.getByText('Approve & Execute Lab Notebook');
    fireEvent.click(approveBtn);
    expect(mockApprove).toHaveBeenCalledWith('asgn_await_999', '');

    // Open Inspect Modal
    const inspectBtn = screen.getByText('Inspect Extraction & Plan');
    fireEvent.click(inspectBtn);

    // Modal should show raw pypdf text inspector
    expect(screen.getByText(/Assignment Analysis & Extraction Inspector/i)).toBeInTheDocument();
    expect(screen.getByText(/Compute gradients for Cross Entropy Loss/i)).toBeInTheDocument();
  });

  it('renders completed assignments with Preview Executed Notebook option', () => {
    const completedAssignments = [
      {
        assignment_id: 'asgn_completed_111',
        title: 'Data Science Lab 1',
        source_filename: 'lab1.pdf',
        status: 'completed',
        created_at: '2026-03-28T10:00:00Z',
        notebook_blob_name: 'courses/lab1.ipynb',
        pdf_blob_name: 'courses/lab1.pdf'
      }
    ];

    render(
      <CourseAssignments
        courseName="CS 101"
        assignments={completedAssignments}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Preview Executed Notebook/i)).toBeInTheDocument();
    expect(screen.getByText(/Download \.ipynb/i)).toBeInTheDocument();
    expect(screen.getByText(/Download Solution PDF/i)).toBeInTheDocument();
  });
});


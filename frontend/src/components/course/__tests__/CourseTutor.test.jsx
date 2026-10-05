import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseTutor from '../CourseTutor';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

describe('CourseTutor Component', () => {
  it('renders initial empty state with starter prompts for course', () => {
    const sendMessage = vi.fn();
    render(
      <CourseTutor
        courseName="Machine Learning"
        lectureCount={4}
        messages={[]}
        input=""
        setInput={vi.fn()}
        loading={false}
        sendMessage={sendMessage}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Course AI Tutor')).toBeInTheDocument();
    expect(screen.getByText(/4 lectures indexed/i)).toBeInTheDocument();
    expect(screen.getByText(/Ask anything about Machine Learning/i)).toBeInTheDocument();
    expect(screen.getByText('Course Overview & Core Themes')).toBeInTheDocument();

    const starterBtn = screen.getByText('Course Overview & Core Themes');
    fireEvent.click(starterBtn);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("What are the core concepts and fundamental themes")
    );
  });

  it('renders chat messages with clickable lecture citations', () => {
    const handleSelectLecture = vi.fn();
    const mockMessages = [
      {
        id: 'msg_u_1',
        sender: 'user',
        text: 'What is gradient descent?'
      },
      {
        id: 'msg_b_1',
        sender: 'bot',
        text: 'Gradient descent minimizes the loss function step by step.',
        citations: [
          {
            video_id: 'vid_ml_1',
            video_title: 'Lecture 2: Optimization',
            timestamp: '14:20',
            text: 'Gradient descent update rule.'
          }
        ],
        model: 'Gemini 2.0 Flash'
      }
    ];

    render(
      <CourseTutor
        courseName="Machine Learning"
        lectureCount={4}
        messages={mockMessages}
        input=""
        setInput={vi.fn()}
        loading={false}
        handleSelectLecture={handleSelectLecture}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('What is gradient descent?')).toBeInTheDocument();
    expect(screen.getByText(/Gradient descent minimizes the loss function/i)).toBeInTheDocument();
    expect(screen.getByText(/Lecture Citations/i)).toBeInTheDocument();

    // Citation button
    const citationBtn = screen.getByRole('button', { name: /Lecture 2: Optimization/i });
    expect(citationBtn).toBeInTheDocument();
    fireEvent.click(citationBtn);
    expect(handleSelectLecture).toHaveBeenCalledWith('vid_ml_1', 'Machine Learning', '14:20');
  });

  it('allows user to type and submit messages', () => {
    const setInput = vi.fn();
    const sendMessage = vi.fn();

    render(
      <CourseTutor
        courseName="Machine Learning"
        lectureCount={4}
        messages={[]}
        input="Explain backpropagation"
        setInput={setInput}
        loading={false}
        sendMessage={sendMessage}
        currentTheme={mockTheme}
      />
    );

    const sendBtn = screen.getByRole('button', { name: /Send query/i });
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);
    expect(sendMessage).toHaveBeenCalled();
  });

  it('shows loading indicator when generating response', () => {
    render(
      <CourseTutor
        courseName="Machine Learning"
        lectureCount={4}
        messages={[]}
        input=""
        setInput={vi.fn()}
        loading={true}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/Course AI Tutor is searching lecture transcripts/i)).toBeInTheDocument();
  });

  it('renders error alert when error prop is present', () => {
    render(
      <CourseTutor
        courseName="Machine Learning"
        lectureCount={4}
        messages={[]}
        input=""
        setInput={vi.fn()}
        loading={false}
        error="Unable to connect to course tutor service."
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Unable to connect to course tutor service.')).toBeInTheDocument();
  });
});

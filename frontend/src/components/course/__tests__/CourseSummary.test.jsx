import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CourseSummary from '../CourseSummary';
import { LMS_THEMES } from '../../../store/themeStore';

const mockTheme = LMS_THEMES.academic;

const mockSummaryData = {
  course_name: 'Linear Algebra',
  executive_summary: 'Master the four fundamental subspaces and matrix decompositions.',
  thematic_modules: [
    {
      module_title: 'Vector Spaces & Orthogonality',
      lectures_covered: ['Lecture 1', 'Lecture 2'],
      core_themes: 'Basis, dimension, and Gram-Schmidt process',
      key_takeaways: ['Subspaces must contain origin', 'Orthogonal vectors have dot product 0']
    }
  ],
  core_formulas_and_definitions: [
    {
      term: 'Orthogonality',
      formula_or_def: 'v^T w = 0',
      significance: 'Fundamental condition for perpendicular vectors in Hilbert space'
    }
  ],
  lecture_summaries: [
    {
      lecture_id: 'vid_1',
      lecture_title: 'Lecture 1: The Geometry of Linear Equations',
      synopsis: 'Row picture vs column picture of linear systems.',
      key_points: ['Row picture intersects hyperplanes', 'Column picture is linear combination of columns']
    }
  ],
  master_exam_checklist: [
    'Perform Gaussian elimination and back-substitution',
    'Calculate nullspace basis vectors'
  ]
};

describe('CourseSummary Component', () => {
  it('renders initial state with Generate Course Summary button when summaryData is null', () => {
    const fetchSummary = vi.fn();
    render(
      <CourseSummary
        courseName="Linear Algebra"
        lectureCount={5}
        summaryData={null}
        loading={false}
        error={null}
        fetchSummary={fetchSummary}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Linear Algebra Course Summary')).toBeInTheDocument();
    const generateBtn = screen.getByRole('button', { name: /generate course summary/i });
    expect(generateBtn).toBeInTheDocument();

    fireEvent.click(generateBtn);
    expect(fetchSummary).toHaveBeenCalledWith(true);
  });

  it('renders loading state when loading is true', () => {
    render(
      <CourseSummary
        courseName="Linear Algebra"
        loading={true}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText(/synthesizing course-level summary/i)).toBeInTheDocument();
  });

  it('renders full summary with executive summary, modules, formulas, synopses, and checklist', () => {
    const handleSelectLecture = vi.fn();
    const regenerateSummary = vi.fn();

    render(
      <CourseSummary
        courseName="Linear Algebra"
        lectureCount={5}
        summaryData={mockSummaryData}
        loading={false}
        error={null}
        handleSelectLecture={handleSelectLecture}
        regenerateSummary={regenerateSummary}
        currentTheme={mockTheme}
      />
    );

    // Header and Executive summary
    expect(screen.getByText('Course Executive Summary')).toBeInTheDocument();
    expect(screen.getByText(/Master the four fundamental subspaces/i)).toBeInTheDocument();

    // Thematic modules
    expect(screen.getByText('Vector Spaces & Orthogonality')).toBeInTheDocument();
    expect(screen.getByText(/Subspaces must contain origin/i)).toBeInTheDocument();

    // Core formulas
    expect(screen.getByText('Orthogonality')).toBeInTheDocument();
    expect(screen.getByText(/Fundamental condition for perpendicular vectors/i)).toBeInTheDocument();

    // Lecture synopsis
    expect(screen.getByText('Lecture 1: The Geometry of Linear Equations')).toBeInTheDocument();

    // Master exam checklist
    expect(screen.getByText('Perform Gaussian elimination and back-substitution')).toBeInTheDocument();

    // Click regenerate
    const regenBtn = screen.getByRole('button', { name: /regenerate/i });
    fireEvent.click(regenBtn);
    expect(regenerateSummary).toHaveBeenCalled();
  });

  it('toggles checklist items when clicked', () => {
    render(
      <CourseSummary
        courseName="Linear Algebra"
        summaryData={mockSummaryData}
        currentTheme={mockTheme}
      />
    );

    const checklistItem = screen.getByText('Perform Gaussian elimination and back-substitution');
    expect(screen.getByText('0 / 2 Completed')).toBeInTheDocument();

    fireEvent.click(checklistItem);
    expect(screen.getByText('1 / 2 Completed')).toBeInTheDocument();

    fireEvent.click(checklistItem);
    expect(screen.getByText('0 / 2 Completed')).toBeInTheDocument();
  });

  it('renders formulas when payload uses name, formula, and description schema keys', () => {
    const summaryWithAltKeys = {
      course_name: 'Machine Learning',
      executive_summary: 'Statistical learning overview.',
      core_formulas_and_definitions: [
        {
          name: 'Mean Squared Error',
          formula: '$$MSE = \\frac{1}{n} \\sum (y_i - \\hat{y}_i)^2$$',
          description: 'Measures average squared difference between estimated values and actual value.'
        }
      ]
    };

    render(
      <CourseSummary
        courseName="Machine Learning"
        summaryData={summaryWithAltKeys}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Mean Squared Error')).toBeInTheDocument();
    expect(screen.getByText(/Measures average squared difference/i)).toBeInTheDocument();
  });

  it('renders bare LaTeX formulas containing sizing brackets correctly via KaTeX', () => {
    const summaryWithBareFormula = {
      course_name: 'Machine Learning',
      executive_summary: 'Statistical learning overview.',
      core_formulas_and_definitions: [
        {
          term: 'Cross-Entropy Loss',
          formula_or_def: String.raw`\mathcal{L}_{\text{CE}} = -\frac{1}{N}\sum_{i=1}^{N}\big[ y_i\log \hat{y}_i + (1-y_i)\log(1-\hat{y}_i) \big]`,
          significance: 'Measures divergence between predicted and true distributions.'
        }
      ]
    };

    const { container } = render(
      <CourseSummary
        courseName="Machine Learning"
        summaryData={summaryWithBareFormula}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('Cross-Entropy Loss')).toBeInTheDocument();
    const katexEl = container.querySelector('.katex');
    expect(katexEl).toBeInTheDocument();
    const katexHtml = container.querySelector('.katex-html');
    expect(katexHtml).toBeInTheDocument();
    expect(katexHtml.textContent).not.toContain('\\big[');
  });

  it('allows student users (isTutor=false) to regenerate course summary when regenerateSummary is passed', () => {
    const regenerateSummary = vi.fn();

    render(
      <CourseSummary
        courseName="Linear Algebra"
        lectureCount={5}
        summaryData={mockSummaryData}
        loading={false}
        error={null}
        isTutor={false}
        regenerateSummary={regenerateSummary}
        currentTheme={mockTheme}
      />
    );

    const regenBtn = screen.getByRole('button', { name: /regenerate/i });
    expect(regenBtn).toBeInTheDocument();
    fireEvent.click(regenBtn);
    expect(regenerateSummary).toHaveBeenCalledTimes(1);
  });

  it('renders Retry button in error alert and invokes regenerateSummary on click', () => {
    const regenerateSummary = vi.fn();

    render(
      <CourseSummary
        courseName="Linear Algebra"
        summaryData={mockSummaryData}
        loading={false}
        error="LLM timeout while regenerating course summary"
        regenerateSummary={regenerateSummary}
        currentTheme={mockTheme}
      />
    );

    expect(screen.getByText('LLM timeout while regenerating course summary')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(regenerateSummary).toHaveBeenCalledTimes(1);
  });

  it('invokes regenerateSummary from initial empty state when Generate Course Summary is clicked', () => {
    const regenerateSummary = vi.fn();

    render(
      <CourseSummary
        courseName="Linear Algebra"
        summaryData={null}
        loading={false}
        error={null}
        regenerateSummary={regenerateSummary}
        currentTheme={mockTheme}
      />
    );

    const generateBtn = screen.getByRole('button', { name: /generate course summary/i });
    fireEvent.click(generateBtn);
    expect(regenerateSummary).toHaveBeenCalledTimes(1);
  });
});


# LectureScribe LMS Evolution Master Tracker

> **Status:** Active Master Tracker  
> **Last Updated:** 2026-10-24  
> **Objective:** Evolve LectureScribe from an AI lecture-centric learning & content management tool into a full, Moodle-grade enterprise Learning Management System (LMS).

---

## 📊 Executive Progress Dashboard

| Phase / Milestone | Focus Area | Total Epics | Completed | In Progress | Pending | Target Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Phase 0** | Existing LectureScribe Baseline & Course Entity Normalization | 5 | 2 | 1 | 2 | 🟡 In Progress |
| **Milestone 1** | Core Foundation, Tutor/Student RBAC & Access Control | 6 | 1 | 0 | 5 | 🟢 M1A Complete |
| **Milestone 2** | Assessment, Question Bank, Assignments & Gradebook Engine | 5 | 0 | 1 | 4 | 🟡 In Progress |
| **Milestone 3** | Engagement, Forums, Conditional Access & Completion Tracking | 4 | 0 | 0 | 4 | ⚪ Not Started |
| **Milestone 4** | Advanced Ecosystem (Rubrics, Competencies, LTI/SCORM, Analytics) | 5 | 0 | 0 | 5 | ⚪ Not Started |

---

## ✅ Completed Sprint: Milestone 1A — Tutor & Student Role System (RBAC v1)

> **Status:** ✅ Completed & Verified (Backend + Frontend + Automated Tests)  
> **Goal:** Introduce first-class **`tutor`** (Editing Teacher / Instructor) and **`student`** (Learner) roles into LectureScribe, gating curriculum authoring, transcript moderation, quiz regeneration, AI assignment solving, and course management vs. learner consumption, note-taking, and exam attempts.

### 1. Tutor vs. Student Capability Matrix (Finalized Decisions)

> **Design Decisions Locked (2026-10-24):**
> 1. **Role Bootstrap & Switcher:** Users default to `'student'`, with `TUTOR_EMAILS` in `.env` bootstrapping designated accounts to `'tutor'`, plus a live **"Switch to Student / Tutor View"** toggle in the [`Header.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/layout/Header.jsx) user menu.
> 2. **Strict Course & Lecture Creation:** Students **cannot** create courses or ingest new lecture URLs (`QuickAddBar` and lecture ingestion are restricted strictly to `tutor`).
> 3. **Tutor-Only Assignment Solver:** [`CourseAssignments.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/CourseAssignments.jsx) (AI Jupyter Notebook & PDF solution generator) and the **Assignments** course tab are restricted strictly to **Tutors (`isTutor === true`)**.

| Feature / Domain Area | `tutor` (Instructor / Creator) | `student` (Enrolled Learner) | `guest` (Unauthenticated) |
| :--- | :--- | :--- | :--- |
| **Course Management** ([`CourseGrid.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/CourseGrid.jsx)) | Create courses, edit metadata, generate enrollment keys, delete courses (`handleDeleteCourse`). | Browse courses, pin courses (`handleTogglePin`); **cannot create or delete courses**. | View public/sample catalog only. |
| **Lectures & Ingestion** ([`QuickAddBar.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/home/QuickAddBar.jsx), [`CourseLectures.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/CourseLectures.jsx)) | See `QuickAddBar`, ingest/transcribe new lecture URLs (`handleTranscribe`), upload videos to GCS, delete lectures (`handleDeleteFromLibrary`). | Watch lectures, search transcripts, track personal watch progress; **`QuickAddBar` and lecture deletion hidden/blocked**. | Watch public lectures (session-only progress); **`QuickAddBar` hidden**. |
| **Transcript Moderation** (`lecturescribe_transcript_suggestions`) | Directly edit cues; **Approve / Reject** student transcript suggestions (`lecturescribe_transcript_reviews`). | Submit transcript correction suggestions; create personal highlights/annotations (`TextSelectionToolbar.jsx`). | Read-only transcript view. |
| **Course Summary** ([`CourseSummary.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/CourseSummary.jsx)) | Trigger LLM regeneration (`regenerateSummary`) & publish canonical course summary. | Read published executive summary & jump to lecture timestamps (`Regenerate` button hidden). | Read published summary. |
| **Course Quiz & Exams** ([`CourseQuiz.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/CourseQuiz.jsx)) | Generate/Regenerate course quiz bank (`fetchOrGenerateQuiz(true)`), configure timer/marks, view all student attempts. | Take timed exams (`startExam`), view personal attempt history (`quizHistory`), replay past attempts, view AI explanations post-submission. | Disabled or demo preview. |
| **Course Library & Notes** ([`CourseLibrary.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/CourseLibrary.jsx)) | Upload official course slides/PDFs (`openUploadModal`), delete resources (`handleDeleteResource`), extract/delete required readings (`triggerExtractReadings`). | View/download slides & readings; create & manage **personal** scratchpad notes (`New Note` / `CourseNotepadView.jsx`). Cannot upload/delete course resources. | View public resources only. |
| **Course Assignments Solver** ([`CourseAssignments.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/CourseAssignments.jsx)) | **Full Access:** Upload assignment PDFs & datasets, generate/regenerate AI Jupyter Notebook & PDF reference solutions, delete assignments. | **Hidden / Restricted:** Students cannot access the AI Assignment Solver or upload/generate reference solutions. | **Hidden / Restricted.** |

### 2. RBAC v1 Data Schema (`backend/database.py` + Alembic)
- [x] **M1A-DB-01: `lecturescribe_users` Table**
  ```sql
  CREATE TABLE IF NOT EXISTS lecturescribe_users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255),
      picture_url TEXT,
      system_role VARCHAR(32) NOT NULL DEFAULT 'student', -- 'admin' | 'tutor' | 'student'
      active_view_role VARCHAR(32) DEFAULT NULL,          -- Allows Tutors to toggle "Switch to Student View"
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```
- [x] **M1A-DB-02: `lecturescribe_course_memberships` Table (Contextual Course Role)**
  ```sql
  CREATE TABLE IF NOT EXISTS lecturescribe_course_memberships (
      id SERIAL PRIMARY KEY,
      course_slug VARCHAR(255) NOT NULL,                  -- Links to lecturescribe_courses(slug)
      user_email VARCHAR(255) NOT NULL,
      course_role VARCHAR(32) NOT NULL DEFAULT 'student', -- 'tutor' | 'student'
      enrol_method VARCHAR(32) NOT NULL DEFAULT 'manual', -- 'creator' | 'manual' | 'self_key' | 'domain_auto'
      status VARCHAR(32) NOT NULL DEFAULT 'active',       -- 'active' | 'suspended'
      enrolled_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (course_slug, user_email)
  );
  ```

### 3. RBAC v1 Implementation Checklist
- [x] **M1A-BE-01: Auth Sync & Role Resolution ([`backend/main.py`](file:///home/dipes/projects/lecturescribe/backend/main.py) & [`backend/database.py`](file:///home/dipes/projects/lecturescribe/backend/database.py))**
  - Added `POST /api/auth/session` (called on Google Sign-In in [`useGoogleAuth.js`](file:///home/dipes/projects/lecturescribe/frontend/src/hooks/useGoogleAuth.js) or on page load) to upsert `lecturescribe_users` and return `{ email, name, system_role, effective_role, is_tutor, is_student, course_roles }`.
  - Added `TUTOR_EMAILS` bootstrap in `.env.example` and `require_tutor_role(...)` enforcement on course deletion and assignment upload/deletion endpoints.
- [x] **M1A-BE-02: Course Roster & Role Assignment Endpoints**
  - `GET /api/course/{course_name}/members` — List Tutors and Students in a course.
  - `POST /api/course/{course_name}/members` — Tutor invites/promotes a user email to `tutor` or `student`.
  - `GET /api/auth/role` & `PATCH /api/auth/role` — Allows switching role between `tutor` and `student`.
- [x] **M1A-FE-01: Role Context & Hook ([`useGoogleAuth.js`](file:///home/dipes/projects/lecturescribe/frontend/src/hooks/useGoogleAuth.js))**
  - Exposed `userRole` (`'tutor' | 'student' | 'guest'`), `isTutor`, `isStudent`, `courseRoles`, and `switchUserRole()` across [`App.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/App.jsx), [`Header.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/layout/Header.jsx), and [`HomeView.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/views/HomeView.jsx).
- [x] **M1A-FE-02: Header Role Badge & "Switch to Student/Tutor View" Toggle ([`Header.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/layout/Header.jsx))**
  - Added interactive role pill (`Tutor` / `Student`) next to the user avatar and inside the profile dropdown menu.
- [x] **M1A-FE-03: Role-Gated Course Views ([`HomeView.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/views/HomeView.jsx) & Course Sub-views)**
  - Gated `QuickAddBar` (course & lecture creation), `Assignments` tab (`CourseAssignments.jsx`), `Delete Course`, `Delete Lecture`, `Upload File`, `Delete Resource`, `Extract Readings`, `Regenerate Summary`, and `Generate New Quiz` strictly behind `isTutor`.
  - Kept student-centric actions (`New Note`, `Take Quiz`, `Ask Course Tutor`, `Bookmark/Pin`) available to both `student` and `tutor`.

---

## 🏛️ Phase 1: Moodle Functional Capability Index (Reference Architecture)

This index serves as the domain benchmark for all capabilities tracked in this document.

### 1. User Roles & Permissions (Contextual RBAC)
- **Hierarchical Context Tree:**
  1. `SYSTEM` (10): Global platform settings, user directories, and plugin administration.
  2. `CATEGORY` (20): Academic departments, semesters, or degree tracks (e.g., *Computer Science*, *Fall 2026*).
  3. `COURSE` (30): Specific instructional offering (`lecturescribe_courses`).
  4. `MODULE` (40): Individual activity or resource instance inside a course (`course_modules`).
- **Standard Archetype Roles:**
  - `admin` (Administrator): Unfettered system-wide control.
  - `manager` (Manager): Category/system operational administration without system config changes.
  - `coursecreator` (Course Creator): Can instantiate courses and manage their own created courses.
  - `editingteacher` (Instructor): Full curriculum authoring, course layout editing, activity configuration, and grading.
  - `teacher` (Non-Editing Teacher / TA): Facilitates forums, views restricted items, and grades submissions; cannot alter course structure.
  - `student` (Learner): Consumes resources, submits activities, participates in peer/forum tasks, and views personal gradebook.
  - `guest` (Auditor): Read-only access to permitted course views without state persistence or grading.

### 2. Course Architecture & Formatting
- **Course Formats:** `topics` (modular units), `weekly` (date-bound sections), `single_activity` (standalone exam, SCORM, or forum).
- **Conditional Access Engine (Restrict Access):** Nested boolean trees (`AND` / `OR` / `NOT`) gating sections or modules by Date/Time, prior Grade thresholds, Activity Completion state, Cohort/Group membership, or User Profile fields.
- **Completion Tracking Engine:**
  - *Manual Completion:* Student toggles `"Mark as done"`.
  - *Automatic Completion:* System evaluates rules (`require_view`, `require_grade`, `require_pass`, `require_posts >= N`).
  - *Course Completion:* Aggregated rule engine across designated mandatory activities and minimum overall course grade.

### 3. Pedagogical Toolkit (Activities & Resources)
- **Static & Structured Resources:**
  - `lecture` (LectureScribe Native AI Video + Transcript + Notes + Slides + RAG Chat)
  - `resource` (Files & Folders with MIME handling), `page` (Rich Markdown/HTML), `url` (External deep links), `book` (Multi-chapter paginated reading (`lecturescribe_course_readings`)).
- **Interactive & Evaluative Activities:**
  - `quiz`: Decoupled Question Bank, randomized slot draws, timed attempts, server-authoritative grading, deferred/immediate/adaptive feedback modes.
  - `assignment`: File/text submissions, draft states, late cutoffs, blind marking, split-screen SpeedGrader, annotation tools.
  - `forum`: Standard discussions, Q&A (post-before-viewing-replies), Single-topic, Announcements, whole-forum grading & peer ratings.
  - `workshop`: Multi-phase peer review state machine (Setup $\rightarrow$ Submission $\rightarrow$ Assessment $\rightarrow$ Grading Evaluation $\rightarrow$ Closed).
  - `lesson`: Adaptive branching scenarios routing learners based on per-page responses.
  - `glossary` / `wiki` / `database`: Collaborative student-contributed repositories with course-wide auto-linking.
  - `lti` / `scorm`: LTI 1.3 Advantage external tool launches and SCORM 1.2/2004 runtime players.

### 4. Assessment & Analytics
- **Centralized Gradebook:** Hierarchical `grade_categories` and `grade_items`; aggregations (`WEIGHTED_MEAN`, `NATURAL_SUM`, `SIMPLE_MEAN`, `DROP_LOWEST`); grade scales, overrides, exclusions, and locks.
- **Advanced Grading Methods:** 2D Criterion $\times$ Level **Rubrics** and structured **Marking Guides** with reusable comment banks.
- **Competency Frameworks:** Hierarchical skill trees linked to courses and activities with automated evidence logging.
- **Analytics & Audit Trail:** Immutable `Actor - Verb - Object - Context` event stream (`lms_event_log`) powering at-risk student predictive indicators.

### 5. Infrastructure & Administration
- **Authentication:** Local credentials, OAuth2/OIDC (Google/GitHub/Microsoft), LDAP/SAML2, and Guest session isolation.
- **Enrollment Engine:** Decoupled from authentication—Manual enrollment, Self-enrollment (with enrollment keys/passwords & capacity caps), Cohort sync, and Stripe/payment gateways.
- **Extensibility:** Standardized `ActivityModuleDriver` interface on backend and lazy-loaded module registry on frontend.

---

## 🔍 Phase 2: Gap Analysis Matrix (LectureScribe Baseline vs. Moodle Benchmark)

| ID | Subsystem / Feature | Moodle Benchmark Standard | Current LectureScribe Baseline | Gap Severity | Target Milestone |
| :--- | :--- | :--- | :--- | :---: | :---: |
| **GAP-01** | **Contextual RBAC** | Hierarchical contexts (`SYSTEM` $\rightarrow$ `CATEGORY` $\rightarrow$ `COURSE` $\rightarrow$ `MODULE`) with 400+ capabilities. | Basic user authentication & guest isolation (`ANONYMOUS_REMOVAL_AND_GUEST_ISOLATION_PLAN.md`); no contextual role assignments. | 🔴 **High** | Milestone 1 |
| **GAP-02** | **First-Class Course Hierarchy** | Nested course categories (`ltree`) and normalized course entities. | Denormalized `course_name` strings across tables; normalization planned in `docs/course-entity-migration-plan.md`. | 🟠 **Medium** | Milestone 1 |
| **GAP-03** | **Enrollment Subsystem** | Pluggable enrollment plugins (Manual, Self + Key, Cohort Sync, Paid) with time windows. | Library mapping (`lecturescribe_user_library`) without formal enrollment methods, keys, or roles. | 🔴 **High** | Milestone 1 |
| **GAP-04** | **Polymorphic Course Spine** | Unified `course_sections` & `course_modules` hosting 20+ activity types. | Separate tabs/tables for Videos, Readings (`lecturescribe_course_readings`), Resources, and Course Quiz. | 🔴 **High** | Milestone 1 |
| **GAP-05** | **Conditional Access Rules** | Boolean rule trees gating modules/sections by date, grade, or completion. | All course items are immediately accessible without prerequisite gating. | 🔴 **High** | Milestone 3 |
| **GAP-06** | **Completion Tracking Engine** | Manual checkboxes + automated rule triggers (`view`, `grade`, `pass`, `posts`). | Basic video playback progress & quiz history (`lecturescribe_course_quiz_history`); no unified completion engine. | 🟠 **Medium** | Milestone 3 |
| **GAP-07** | **AI Lecture & Note Synthesis** | Static files/embeds only; no native transcription, slide OCR, or RAG chat. | **Core Advantage:** Automated Whisper transcription, slide extraction, RRF RAG chat, and literature search. | 🟢 **Advantage** | Phase 0 (Done) |
| **GAP-08** | **Question Bank & Quiz Engine** | Decoupled reusable Question Bank, 15+ item types, random draws, server-side attempt timer & grading. | `CourseQuiz.jsx` + `lecturescribe_course_quizzes` with 30-min timer, replay mode, and AI explanations, but tightly coupled to MCQ course quizzes without a reusable Question Bank. | 🔴 **High** | Milestone 2 |
| **GAP-09** | **Assignments & Submissions** | File/text submissions, draft/cutoff dates, blind grading, SpeedGrader annotations. | Absent; no workflow for students to upload artifacts for instructor grading. | 🔴 **High** | Milestone 2 |
| **GAP-10** | **Centralized Gradebook** | Multi-category gradebook with weighted aggregations, drop-lowest, overrides, and exports. | Isolated quiz scores (`earnedMarks` / `totalMarks`); no unified course gradebook ledger. | 🔴 **High** | Milestone 2 |
| **GAP-11** | **Asynchronous Forums** | Multi-mode Forums (General, Q&A, Announcements) with read tracking & grading. | Single-user AI Course Chat (`lecturescribe_course_chat_logs`), no multi-user course discussion forums. | 🟠 **Medium** | Milestone 3 |
| **GAP-12** | **Advanced Grading (Rubrics)** | 2D Rubrics and Marking Guides attachable to any gradable activity. | Direct point scoring (`marksPerQuestion = 0.5`) on auto-graded quiz items only. | 🟠 **Medium** | Milestone 4 |
| **GAP-13** | **Workshops & Branching Lessons** | Multi-phase peer review state machine and adaptive branching pages. | Absent. | 🔵 **Low** | Milestone 4 |
| **GAP-14** | **LTI 1.3 & SCORM Interop** | LTI 1.3 Advantage Provider/Consumer and SCORM 1.2/2004 runtime players. | Moodle browser extension scraper (`extension/`), but no standard LTI/SCORM runtime. | 🟠 **Medium** | Milestone 4 |
| **GAP-15** | **Pedagogical Event Log & Risk AI** | Append-only event stream (`Actor-Verb-Object-Context`) + at-risk student flags. | Application logs only; no unified learning analytics event store. | 🟠 **Medium** | Milestone 4 |
| **GAP-16** | **Activity Plugin Architecture** | Standardized module driver contract for registering new activity types cleanly. | Hardcoded views per feature tab (`CourseQuiz`, `LecturePlayer`, `CourseReadings`). | 🔴 **High** | Milestone 4 |

---

## 🗺️ Phase 3: Master Implementation Roadmap & Task Tracker

### Phase 0: Baseline Consolidation & Course Entity Normalization (Pre-LMS Bridge)
*Align existing LectureScribe infrastructure with relational course identifiers before adding multi-role LMS layers.*

- [x] **P0-1: GCS Video & HLS Pipeline** — Stream progressive MP4 & adaptive HLS into `gs://lecturescribe-resources` (`backend/gcs_storage.py`).
- [x] **P0-2: Course Quiz Exam Mode UI & AI Explanations** — Interactive exam timer, question palette, replay mode, and AI explanations in [`CourseQuiz.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/CourseQuiz.jsx).
- [ ] **P0-3: Execute First-Class Course Entity Migration** (`docs/course-entity-migration-plan.md`)
  - [ ] Create `lecturescribe_courses` table (`id UUID PK`, `slug UNIQUE`, `name`, `created_at`, `updated_at`).
  - [ ] Backfill `course_id` and `course_slug` across `lecturescribe_videos`, `lecturescribe_user_library`, `lecturescribe_resources`, `lecturescribe_course_readings`, `lecturescribe_course_quizzes`, `lecturescribe_course_quiz_history`, `lecturescribe_course_quiz_explanations`, and `lecturescribe_course_chat_logs`.
  - [ ] Update `backend/database.py` DAO methods to dual-write `course_id`, `course_slug`, and `course_name`.
- [ ] **P0-4: Moodle Source URL Mapping & Native GCS Video Player** (`TODO.md`)
  - [ ] Add `POST /api/moodle/map-video` in `backend/main.py` and store `moodle_url` on `lecturescribe_videos`.
  - [ ] Upgrade `LecturePlayer.jsx` to switch from external `<iframe>` to native HTML5 `<video>` when `gcs_video_url` is present.

---

### Milestone 1: Core Foundation & Access Control
**Goal:** Establish multi-tenant hierarchy, Contextual RBAC, formal Enrollments, and the polymorphic `course_modules` spine.

#### 1.1 Database Schema Checklist (Alembic Migrations)
- [ ] **M1-DB-01: Course Categories & Extended Course Metadata**
  - `course_categories`: `id (UUID PK)`, `parent_id (UUID FK)`, `name`, `slug`, `path (VARCHAR/ltree)`, `sort_order (INT)`, `is_visible (BOOL)`.
  - Extend `lecturescribe_courses`: Add `category_id (UUID FK)`, `shortname (VARCHAR UNIQUE)`, `summary (TEXT)`, `format (VARCHAR DEFAULT 'topics')`, `start_date (TIMESTAMPTZ)`, `end_date (TIMESTAMPTZ)`, `is_published (BOOL DEFAULT true)`.
- [ ] **M1-DB-02: Contextual RBAC Engine Tables**
  - `lms_contexts`: `id (UUID PK)`, `context_level (SMALLINT: 10=SYSTEM, 20=CATEGORY, 30=COURSE, 40=MODULE)`, `instance_id (UUID)`, `path (VARCHAR INDEXED)`.
  - `lms_roles`: `id (UUID PK)`, `shortname (VARCHAR UNIQUE)`, `name`, `description`, `sort_order`.
  - `lms_role_capabilities`: `id (UUID PK)`, `role_id (UUID FK)`, `capability (VARCHAR, e.g. 'course:manageactivities')`, `permission (SMALLINT: 1=ALLOW, -1=PREVENT, -1000=PROHIBIT)`.
  - `lms_role_assignments`: `id (UUID PK)`, `user_id (VARCHAR/UUID FK)`, `role_id (UUID FK)`, `context_id (UUID FK)`, `created_at`.
- [ ] **M1-DB-03: Enrollment & Cohort Tables**
  - `lms_cohorts`: `id (UUID PK)`, `context_id (UUID FK)`, `name`, `idnumber (VARCHAR UNIQUE)`, `description`.
  - `lms_cohort_members`: `cohort_id (UUID FK)`, `user_id (VARCHAR/UUID FK)`, `added_at`.
  - `lms_enrol_methods`: `id (UUID PK)`, `course_id (UUID FK)`, `enrol_type (ENUM: 'manual', 'self', 'cohort', 'guest', 'stripe')`, `name`, `status (BOOL)`, `config (JSONB: password/key, max_enrolled, default_role_id, duration_days)`.
  - `lms_user_enrolments`: `id (UUID PK)`, `enrol_method_id (UUID FK)`, `user_id (VARCHAR/UUID FK)`, `status (ENUM: 'active', 'suspended')`, `time_start (TIMESTAMPTZ)`, `time_end (TIMESTAMPTZ)`, `created_at`.
- [ ] **M1-DB-04: Polymorphic Course Spine (`course_sections` & `course_modules`)**
  - `course_sections`: `id (UUID PK)`, `course_id (UUID FK)`, `section_number (INT)`, `title (VARCHAR)`, `summary (TEXT)`, `visible (BOOL)`, `availability_rules (JSONB)`.
  - `course_modules`: `id (UUID PK)`, `course_id (UUID FK)`, `section_id (UUID FK)`, `module_type (VARCHAR: 'lecture', 'reading', 'resource', 'page', 'url', 'quiz', 'assignment', 'forum')`, `instance_id (UUID)`, `sort_order (INT)`, `visible (BOOL)`, `availability_rules (JSONB)`, `completion_config (JSONB)`.

#### 1.2 Backend API & Services Checklist
- [ ] **M1-BE-01: Contextual Capability Resolver (`backend/auth/rbac.py`)**
  - Implement `has_capability(user_id, capability, context_id)` evaluating role assignments along the materialized `lms_contexts.path` with `PROHIBIT` / `PREVENT` / `ALLOW` precedence.
  - Add FastAPI dependency `RequireCapability("course:update")`.
- [ ] **M1-BE-02: Course Hierarchy & Section Orchestration API**
  - `GET /api/v1/categories` & `POST /api/v1/categories`
  - `GET /api/v1/courses/{course_id}/structure` — Hydrates ordered `course_sections` and polymorphic `course_modules` filtered by caller capabilities.
  - `POST /api/v1/courses/{course_id}/sections` & `PATCH /api/v1/courses/{course_id}/sections/reorder`
  - `POST /api/v1/courses/{course_id}/modules` — Wraps existing lectures (`lecturescribe_videos`), readings (`lecturescribe_course_readings`), and quizzes into `course_modules`.
- [ ] **M1-BE-03: Enrollment Endpoints**
  - `POST /api/v1/courses/{course_id}/enrol/self` (validates enrollment key & capacity).
  - `POST /api/v1/courses/{course_id}/enrol/manual` (Teacher/Manager batch user enrollment + role assignment).
  - `GET /api/v1/courses/{course_id}/participants` (paginated roster with contextual roles and last access).

#### 1.3 Frontend Views & Components Checklist
- [ ] **M1-FE-01: Instructor "Edit Mode" Switch & Course Builder**
  - Add top-bar **Edit Mode** toggle for users with `course:manageactivities`.
  - Implement drag-and-drop section & module ordering (`@dnd-kit`).
  - Build `<AddActivityModal />` picker categorized by **Activities** vs. **Resources** vs. **LectureScribe AI Tools**.
- [ ] **M1-FE-02: Course Participants & Role Management View**
  - Roster table showing enrolled users, active roles (`Editing Teacher`, `TA`, `Student`), enrollment method, and status controls.
- [ ] **M1-FE-03: Self-Enrollment Gate View**
  - Landing card for unenrolled courses prompting for an Enrollment Key or 1-click self-enrollment.

---

### Milestone 2: Assessment & Evaluation Engine
**Goal:** Evolve [`CourseQuiz.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/CourseQuiz.jsx) into a decoupled Question Bank + Server-Authoritative Quiz Engine, add File/Text **Assignments**, and build a **Centralized Gradebook**.

#### 2.1 Database Schema Checklist (Alembic Migrations)
- [ ] **M2-DB-01: Reusable Question Bank Schema**
  - `lms_question_categories`: `id (UUID PK)`, `context_id (UUID FK)`, `parent_id (UUID FK)`, `name`, `info`.
  - `lms_questions`: `id (UUID PK)`, `category_id (UUID FK)`, `source_lecture_id (VARCHAR/UUID NULLABLE FK)`, `question_type (ENUM: 'mcq', 'multi_select', 'true_false', 'short_answer', 'numerical', 'essay')`, `name`, `question_text (TEXT)`, `default_mark (NUMERIC(8,2))`, `penalty_factor (NUMERIC(4,2))`, `payload (JSONB: choices, correct_hashes, tolerances, general_feedback)`, `version (INT)`, `created_by`.
- [ ] **M2-DB-02: Stateful Quiz & Attempt Engine Schema**
  - `lms_quizzes`: `id (UUID PK)`, `course_id (UUID FK)`, `title`, `description`, `time_open (TIMESTAMPTZ)`, `time_close (TIMESTAMPTZ)`, `time_limit_sec (INT)`, `max_attempts (INT)`, `grading_method (ENUM: 'highest', 'average', 'first', 'last')`, `question_behavior (ENUM: 'deferred_feedback', 'immediate_feedback', 'adaptive')`, `shuffle_questions (BOOL)`, `review_options (JSONB)`.
  - `lms_quiz_slots`: `id (UUID PK)`, `quiz_id (UUID FK)`, `slot_number (INT)`, `page (INT)`, `question_id (UUID NULLABLE FK)`, `random_slot_config (JSONB: category_id, include_subcategories, tags, difficulty)`, `max_mark (NUMERIC(8,2))`.
  - `lms_quiz_attempts`: `id (UUID PK)`, `quiz_id (UUID FK)`, `user_id (VARCHAR/UUID FK)`, `attempt_number (INT)`, `state (ENUM: 'in_progress', 'submitted', 'graded', 'abandoned')`, `question_order (JSONB)`, `started_at (TIMESTAMPTZ)`, `submitted_at (TIMESTAMPTZ)`, `time_taken_sec (INT)`, `sum_marks (NUMERIC(10,2))`.
  - `lms_quiz_attempt_responses`: `id (UUID PK)`, `attempt_id (UUID FK)`, `slot_number (INT)`, `question_id (UUID FK)`, `response_payload (JSONB)`, `is_flagged (BOOL)`, `mark_awarded (NUMERIC(8,2))`, `grader_feedback (TEXT)`, `graded_by (UUID NULLABLE)`.
- [ ] **M2-DB-03: Assignment & Submission Schema**
  - `lms_assignments`: `id (UUID PK)`, `course_id (UUID FK)`, `title`, `instructions (TEXT)`, `submission_types (JSONB: ['file', 'online_text'])`, `max_files (INT)`, `max_bytes (BIGINT)`, `allow_submissions_from (TIMESTAMPTZ)`, `due_date (TIMESTAMPTZ)`, `cutoff_date (TIMESTAMPTZ)`, `max_grade (NUMERIC(8,2))`, `blind_marking (BOOL)`.
  - `lms_assignment_submissions`: `id (UUID PK)`, `assignment_id (UUID FK)`, `user_id (VARCHAR/UUID FK)`, `attempt_number (INT)`, `status (ENUM: 'draft', 'submitted', 'reopened', 'graded')`, `online_text (TEXT)`, `file_attachments (JSONB: [{gcs_uri, filename, size, mime}])`, `submitted_at (TIMESTAMPTZ)`, `is_late (BOOL)`, `grade (NUMERIC(8,2))`, `grader_id (VARCHAR/UUID)`, `feedback_markdown (TEXT)`, `graded_at (TIMESTAMPTZ)`.
- [ ] **M2-DB-04: Centralized Gradebook Schema**
  - `lms_grade_categories`: `id (UUID PK)`, `course_id (UUID FK)`, `parent_id (UUID NULLABLE FK)`, `name`, `aggregation (ENUM: 'weighted_mean', 'natural_sum', 'simple_mean', 'highest', 'lowest')`, `drop_lowest (INT DEFAULT 0)`, `weight_override (NUMERIC(6,2))`.
  - `lms_grade_items`: `id (UUID PK)`, `course_id (UUID FK)`, `category_id (UUID FK)`, `item_type (ENUM: 'module', 'manual', 'category_total', 'course_total')`, `module_type (VARCHAR NULLABLE)`, `module_instance_id (UUID NULLABLE)`, `item_name`, `grademax (NUMERIC(8,2))`, `grademin (NUMERIC(8,2))`, `gradepass (NUMERIC(8,2))`, `aggregation_weight (NUMERIC(6,2))`, `is_hidden (BOOL)`, `is_locked (BOOL)`, `sort_order (INT)`.
  - `lms_grade_grades`: `id (UUID PK)`, `grade_item_id (UUID FK)`, `user_id (VARCHAR/UUID FK)`, `raw_grade (NUMERIC(8,2))`, `final_grade (NUMERIC(8,2))`, `is_overridden (BOOL DEFAULT false)`, `is_excluded (BOOL DEFAULT false)`, `feedback (TEXT)`, `updated_at (TIMESTAMPTZ)`.

#### 2.2 Backend API & Services Checklist
- [ ] **M2-BE-01: AI Lecture-to-Question-Bank Generator**
  - Upgrade existing LectureScribe quiz generation (`fetchOrGenerateQuiz`) to optionally export generated questions directly into `lms_question_categories` tagged by lecture timestamp and Bloom's taxonomy level.
- [ ] **M2-BE-02: Server-Authoritative Quiz Attempt API**
  - Strip correct answers (`correct_answer`) from `GET /api/v1/quiz-attempts/{id}` while `state == 'in_progress'`.
  - `POST /api/v1/quizzes/{id}/attempts` — Instantiates attempt, draws random questions from `lms_questions`, records server start timestamp.
  - `PUT /api/v1/quiz-attempts/{id}/responses` — Auto-saves student selections and flagged question state.
  - `POST /api/v1/quiz-attempts/{id}/submit` — Enforces `time_limit_sec` grace period, grades objective items, queues `essay` items for manual grading, and emits `GradeUpdatedEvent`.
- [ ] **M2-BE-03: Assignment Submission & GCS Upload Pipeline**
  - `POST /api/v1/assignments/{id}/submissions` — Stores student artifacts under `gs://lecturescribe-resources/courses/{course_id}/assignments/{assignment_id}/{user_id}/`.
  - `POST /api/v1/assignments/{id}/submissions/{sub_id}/grade` — Records instructor score & feedback, emits `GradeUpdatedEvent`.
- [ ] **M2-BE-04: Gradebook Aggregation Engine (`backend/services/gradebook.py`)**
  - Automatically provision a `lms_grade_items` record whenever a gradable `quiz` or `assignment` is created.
  - Recompute `category_total` and `course_total` in `lms_grade_grades` whenever a student's score changes or category weights are updated.

#### 2.3 Frontend Views & Components Checklist
- [ ] **M2-FE-01: Refactor [`CourseQuiz.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/CourseQuiz.jsx) into Modular Quiz Suite**
  - Preserve existing timer, palette, and AI explanation UX while connecting to server-side `lms_quiz_attempts` auto-save and multi-question type renderers (`ShortAnswer`, `MultiSelect`, `Essay`, `Numerical`).
- [ ] **M2-FE-02: Question Bank Manager (`/course/:slug/question-bank`)**
  - Category tree sidebar, question CRUD modal, tag filtering, and **"Generate from Lecture Transcript"** wizard.
- [ ] **M2-FE-03: Assignment View & Split-Screen SpeedGrader**
  - Student view: Due date countdown, drag-and-drop file uploader, rich-text submission editor, and grading status badge.
  - Instructor SpeedGrader: Inline PDF/Docx/Markdown previewer on the left, score input + feedback editor on the right.
- [ ] **M2-FE-04: Dual Gradebook UI (`/course/:slug/grades`)**
  - **Student User Report:** Hierarchical table showing individual activity grades, weights, percentages, and instructor feedback.
  - **Instructor Grader Report:** Interactive matrix (Students $\times$ Grade Items) with inline score override cells, category weight setup, and CSV export.

---

### Milestone 3: Engagement & Interactivity Layer
**Goal:** Add **Conditional Access Rules (Restrict Access)**, **Activity & Course Completion Tracking**, and **Asynchronous Discussion Forums**.

#### 3.1 Database Schema Checklist (Alembic Migrations)
- [ ] **M3-DB-01: Completion Tracking Tables**
  - `lms_module_completions`: `id (UUID PK)`, `course_module_id (UUID FK)`, `user_id (VARCHAR/UUID FK)`, `state (ENUM: 'incomplete', 'complete', 'complete_pass', 'complete_fail')`, `viewed_at (TIMESTAMPTZ)`, `completed_at (TIMESTAMPTZ)`, `override_by (UUID NULLABLE)`.
  - `lms_course_completions`: `id (UUID PK)`, `course_id (UUID FK)`, `user_id (VARCHAR/UUID FK)`, `completed_at (TIMESTAMPTZ)`, `overall_grade_snapshot (NUMERIC(8,2))`.
- [ ] **M3-DB-02: Asynchronous Forum Tables**
  - `lms_forums`: `id (UUID PK)`, `course_id (UUID FK)`, `title`, `intro (TEXT)`, `forum_type (ENUM: 'general', 'q_and_a', 'single_topic', 'announcements')`, `max_grade (NUMERIC(8,2) NULLABLE)`, `completion_posts_required (INT DEFAULT 0)`.
  - `lms_forum_discussions`: `id (UUID PK)`, `forum_id (UUID FK)`, `author_id (VARCHAR/UUID FK)`, `title`, `is_pinned (BOOL)`, `is_locked (BOOL)`, `linked_lecture_id (VARCHAR NULLABLE)`, `linked_timestamp_sec (INT NULLABLE)`, `created_at (TIMESTAMPTZ)`, `last_post_at (TIMESTAMPTZ)`.
  - `lms_forum_posts`: `id (UUID PK)`, `discussion_id (UUID FK)`, `parent_post_id (UUID NULLABLE FK)`, `author_id (VARCHAR/UUID FK)`, `body_markdown (TEXT)`, `attachments (JSONB)`, `is_endorsed_by_instructor (BOOL)`, `created_at (TIMESTAMPTZ)`, `updated_at (TIMESTAMPTZ)`.
  - `lms_forum_read_receipts`: `user_id (VARCHAR/UUID FK)`, `discussion_id (UUID FK)`, `last_read_at (TIMESTAMPTZ)`.

#### 3.2 Backend API & Services Checklist
- [ ] **M3-BE-01: Conditional Access Rule Evaluator (`backend/services/availability.py`)**
  - Evaluate `course_modules.availability_rules` JSONB boolean AST (`AND`/`OR`/`NOT` over `date`, `grade`, `completion`, `role`) in memory when hydrating course structure.
  - Enforce server-side access guards on direct module API calls so locked quizzes/lectures cannot be fetched via URL manipulation.
- [ ] **M3-BE-02: Event-Driven Completion Engine (`backend/services/completion.py`)**
  - `POST /api/v1/modules/{module_id}/completion/toggle` (for manual completion).
  - Auto-evaluators triggered on `LectureWatched (>= 80% duration)`, `QuizSubmitted`, `GradeUpdated`, and `ForumPostCreated`.
- [ ] **M3-BE-03: Forum Service & Q&A Gatekeeper**
  - Redact peer responses in `q_and_a` forums until the requesting student has authored at least one reply in that discussion thread (and 15-minute editing window has elapsed).
  - Support timestamp citations (`[12:34]`) in forum posts that deep-link directly into LectureScribe's `LecturePlayer`.

#### 3.3 Frontend Views & Components Checklist
- [ ] **M3-FE-01: `<RestrictAccessBuilder />` Modal**
  - Visual rule builder in Module Settings to configure prerequisite conditions (e.g., *"Must complete Lecture 2 AND score $\ge 70\%$ on Quiz 1"*).
- [ ] **M3-FE-02: Completion Badges & Course Progress Bar**
  - Module cards display interactive `"Mark as done"` buttons or automated requirement pills (`To do: Watch lecture`, `To do: Receive a passing grade`, `Done ✓`).
- [ ] **M3-FE-03: Course Discussion Forum & Timestamp Thread UI**
  - Threaded discussion view with Markdown + LaTeX support, instructor endorsement badges, unread post highlights, and 1-click **"Ask in Course Forum at [mm:ss]"** button inside `LecturePlayer`.

---

### Milestone 4: Advanced Ecosystem & Scalability
**Goal:** Deliver **Rubrics & Marking Guides**, **Competency Frameworks**, **LTI 1.3 / SCORM Interoperability**, **Learning Analytics / At-Risk Detection**, and a **Pluggable Activity Registry**.

#### 4.1 Database Schema Checklist (Alembic Migrations)
- [ ] **M4-DB-01: Advanced Grading (Rubrics & Marking Guides)**
  - `lms_grading_definitions`: `id (UUID PK)`, `context_id (UUID FK)`, `method (ENUM: 'rubric', 'marking_guide')`, `name`, `description`, `status (ENUM: 'draft', 'ready')`.
  - `lms_rubric_criteria`: `id (UUID PK)`, `definition_id (UUID FK)`, `sort_order (INT)`, `description (TEXT)`.
  - `lms_rubric_levels`: `id (UUID PK)`, `criterion_id (UUID FK)`, `score (NUMERIC(8,2))`, `definition_text (TEXT)`.
  - `lms_rubric_fillings`: `id (UUID PK)`, `target_type (VARCHAR: 'assignment', 'forum')`, `target_submission_id (UUID)`, `criterion_id (UUID FK)`, `level_id (UUID NULLABLE FK)`, `score_awarded (NUMERIC(8,2))`, `remark (TEXT)`.
- [ ] **M4-DB-02: Competency Frameworks**
  - `lms_competency_frameworks`: `id (UUID PK)`, `name`, `idnumber`, `scale_config (JSONB)`.
  - `lms_competencies`: `id (UUID PK)`, `framework_id (UUID FK)`, `parent_id (UUID NULLABLE FK)`, `shortname`, `description`.
  - `lms_module_competencies`: `course_module_id (UUID FK)`, `competency_id (UUID FK)`, `rule_outcome (ENUM: 'none', 'attach_evidence', 'complete_competency')`.
  - `lms_user_competencies`: `user_id (VARCHAR/UUID FK)`, `competency_id (UUID FK)`, `proficiency (BOOL)`, `grade_scale_value (INT)`, `reviewer_id (UUID NULLABLE)`.
- [ ] **M4-DB-03: LTI 1.3 Advantage & SCORM Tables**
  - `lms_lti_registrations`: `id (UUID PK)`, `name`, `issuer`, `client_id`, `auth_login_url`, `auth_token_url`, `key_set_url`, `deployment_id`.
  - `lms_lti_module_instances`: `id (UUID PK)`, `course_id (UUID FK)`, `registration_id (UUID FK)`, `title`, `target_link_uri`, `custom_params (JSONB)`, `accept_grades (BOOL)`.
  - `lms_scorm_packages`: `id (UUID PK)`, `course_id (UUID FK)`, `title`, `gcs_extracted_path`, `manifest_url`, `scorm_version (ENUM: '1.2', '2004')`.
  - `lms_scorm_tracks`: `id (UUID PK)`, `scorm_id (UUID FK)`, `user_id (VARCHAR/UUID FK)`, `attempt (INT)`, `cmi_data (JSONB)`, `updated_at (TIMESTAMPTZ)`.
- [ ] **M4-DB-04: Append-Only Pedagogical Event Log**
  - `lms_event_log`: `id (BIGSERIAL PK)`, `created_at (TIMESTAMPTZ INDEXED)`, `actor_user_id (VARCHAR/UUID INDEXED)`, `course_id (UUID INDEXED)`, `context_id (UUID)`, `module_type (VARCHAR)`, `module_instance_id (UUID)`, `event_name (VARCHAR)`, `crud (CHAR(1))`, `edulevel (SMALLINT)`, `payload (JSONB)`.

#### 4.2 Backend API & Services Checklist
- [ ] **M4-BE-01: Formal `ActivityModuleDriver` Plugin Registry (`backend/modules/registry.py`)**
  - Standardize lifecycle hooks (`create_instance`, `delete_instance`, `get_grade_metadata`, `evaluate_completion`, `export_backup`) so new module types require zero modifications to core course controllers.
- [ ] **M4-BE-02: LTI 1.3 OIDC Launch & AGS (Assignment and Grade Services) Endpoints**
  - Implement OIDC third-party initiated login, JWT launch signing, and LTI AGS `/scores` webhook to receive external tool grades directly into `lms_grade_grades`.
- [ ] **M4-BE-03: SCORM CMI Runtime API**
  - Provide `GET/POST /api/v1/scorm/{id}/cmi` backing the browser `window.API` (SCORM 1.2) and `window.API_1484_11` (SCORM 2004) adapters.
- [ ] **M4-BE-04: Predictive At-Risk Student Analytics Job**
  - Scheduled background analyzer combining `lms_event_log` recency, lecture watch drop-offs, missed assignment deadlines, and quiz trajectory to compute per-student risk flags (`LOW`, `MEDIUM`, `HIGH`).

#### 4.3 Frontend Views & Components Checklist
- [ ] **M4-FE-01: Interactive 2D Rubric Builder & SpeedGrader Overlay**
  - Matrix editor for defining criteria/levels + clickable cell grading widget in SpeedGrader that auto-sums points.
- [ ] **M4-FE-02: AI Rubric & Lesson Plan Generator**
  - One-click generation of grading rubrics and competency mappings from LectureScribe lecture transcripts and syllabi.
- [ ] **M4-FE-03: Instructor Learning Analytics & At-Risk Dashboard (`/course/:slug/analytics`)**
  - Lecture retention heatmaps, quiz item discrimination analysis, and an **At-Risk Students** action queue with 1-click notification tools.

---

## 🔗 Quick Reference: Related Architecture Docs in Repository

- [`TODO.md`](file:///home/dipes/projects/lecturescribe/TODO.md) — Moodle Source URL & GCS Native Player tasks
- [`docs/course-entity-migration-plan.md`](file:///home/dipes/projects/lecturescribe/docs/course-entity-migration-plan.md) — First-Class `lecturescribe_courses` UUID & Slug Normalization Plan
- [`docs/ANONYMOUS_REMOVAL_AND_GUEST_ISOLATION_PLAN.md`](file:///home/dipes/projects/lecturescribe/docs/ANONYMOUS_REMOVAL_AND_GUEST_ISOLATION_PLAN.md) — Authentication & Guest Isolation Baseline
- [`docs/ACADEMIC_LITERATURE_SEARCH_PIPELINE.md`](file:///home/dipes/projects/lecturescribe/docs/ACADEMIC_LITERATURE_SEARCH_PIPELINE.md) — Academic Literature Discovery Pipeline
- [`frontend/src/components/course/CourseQuiz.jsx`](file:///home/dipes/projects/lecturescribe/frontend/src/components/course/CourseQuiz.jsx) — Current Course Quiz & Exam Mode Implementation


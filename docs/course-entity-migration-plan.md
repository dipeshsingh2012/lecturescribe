# Database Migration & Normalization Plan: First-Class Course Entity

> **Status:** POSTPONED / ROADMAP  
> **Target Date:** Future Database Refactor Milestone  
> **Authors:** Engineering Team  

---

## 1. Executive Summary & Rationale

Currently, courses across the LectureScribe system are stored in a denormalized fashion as plain text strings (`course_name VARCHAR(255)`) across multiple tables (`lecturescribe_videos`, `lecturescribe_user_library`, `lecturescribe_resources`, `lecturescribe_course_readings`, etc.).

While the frontend and API layers have been adapted to use URL-safe slugs (`course_slug`) alongside human-readable names with fallback helper resolvers (`resolve_course_canonical_name`), a proper relational model requires elevating **Courses** into a first-class entity.

Every table associating with a course will consistently store:
1. `course_id` (UUID / Foreign Key)
2. `course_slug` (URL-safe, indexed unique identifier)
3. `course_name` (Human-readable display title)

---

## 2. Target Database Schema

### 2.1 New Table: `lecturescribe_courses`
```sql
CREATE TABLE IF NOT EXISTS lecturescribe_courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pg_courses_slug ON lecturescribe_courses(slug);
```

### 2.2 Impacted Dependent Tables
Each table will be updated to store `course_id`, `course_slug`, and `course_name`:

| Table Name | Changes Required |
| :--- | :--- |
| **`lecturescribe_videos`** | Add `course_id UUID REFERENCES lecturescribe_courses(id) ON DELETE SET NULL`, `course_slug VARCHAR(255)` |
| **`lecturescribe_user_library`** | Add `course_id UUID REFERENCES lecturescribe_courses(id) ON DELETE SET NULL`, `course_slug VARCHAR(255)` |
| **`lecturescribe_resources`** | Add `course_id UUID REFERENCES lecturescribe_courses(id) ON DELETE CASCADE`, `course_slug VARCHAR(255)` |
| **`lecturescribe_course_readings`** | Add `course_id UUID REFERENCES lecturescribe_courses(id) ON DELETE CASCADE`, `course_slug VARCHAR(255)` |
| **`lecturescribe_course_quizzes`** | Add `course_id UUID REFERENCES lecturescribe_courses(id) ON DELETE CASCADE` |
| **`lecturescribe_course_quiz_history`** | Add `course_id UUID REFERENCES lecturescribe_courses(id) ON DELETE CASCADE` |
| **`lecturescribe_course_quiz_explanations`** | Add `course_id UUID REFERENCES lecturescribe_courses(id) ON DELETE CASCADE`, `course_name VARCHAR(255)` |
| **`lecturescribe_course_chat_logs`** | Add `course_id UUID REFERENCES lecturescribe_courses(id) ON DELETE CASCADE` |

---

## 3. Migration Roadmap (Expand & Contract Pattern)

### Phase 1: Expand & Automated Backfill (Non-Breaking)

1. **Schema DDL Execution (Idempotent)**:
   - Add `lecturescribe_courses` table.
   - Use `DO $$ BEGIN ... EXCEPTION WHEN duplicate_column THEN ... END $$;` blocks to append `course_id` and `course_slug` to all child tables without table locks or downtime.

2. **Automated Data Backfill**:
   - Seed `lecturescribe_courses` with distinct courses found across existing tables:
     ```sql
     INSERT INTO lecturescribe_courses (slug, name)
     SELECT DISTINCT 
         regexp_replace(LOWER(TRIM(course_name)), '[^a-z0-9]+', '-', 'g') as slug,
         TRIM(course_name) as name
     FROM (
         SELECT course_name FROM lecturescribe_videos WHERE course_name IS NOT NULL AND course_name != ''
         UNION
         SELECT course_name FROM lecturescribe_user_library WHERE course_name IS NOT NULL AND course_name != ''
         UNION
         SELECT course_name FROM lecturescribe_resources WHERE course_name IS NOT NULL AND course_name != ''
         UNION
         SELECT course_name FROM lecturescribe_course_readings WHERE course_name IS NOT NULL AND course_name != ''
     ) all_courses
     ON CONFLICT (slug) DO NOTHING;
     ```
   - Backfill `course_id` and `course_slug` on all child rows based on matched names or slugs.

3. **Backend DAO Dual-Write (`database.py`)**:
   - Introduce `get_or_create_course(identifier: str) -> Dict[str, Any]`.
   - Update all insert and update methods to populate all three fields (`course_id`, `course_slug`, `course_name`).

---

### Phase 2: API & Frontend Cutover

1. **API Responses**:
   - Ensure course endpoints return all three properties:
     ```json
     {
       "course_id": "87c94b7e-97eb-4ef6-8bfa-78ef86b518c7",
       "course_slug": "machine-learning-paradigms",
       "course_name": "Machine Learning Paradigms"
     }
     ```
2. **Frontend Consumption**:
   - Frontend state stores `{ course_id, course_slug, course_name }`.
   - Routes use `/course/:course_slug` for SEO and human-readable URLs.
   - Mutations and relational associations send `course_id` where applicable.

---

### Phase 3: Post-Migration Cleanup & Decommissioning

Once Phase 1 and 2 are fully validated in production:

1. **Database Hardening & Constraints**:
   - Add strict foreign key constraints:
     ```sql
     ALTER TABLE lecturescribe_videos ADD CONSTRAINT fk_videos_course FOREIGN KEY (course_id) REFERENCES lecturescribe_courses(id) ON DELETE SET NULL;
     ALTER TABLE lecturescribe_course_readings ALTER COLUMN course_id SET NOT NULL, ADD CONSTRAINT fk_readings_course FOREIGN KEY (course_id) REFERENCES lecturescribe_courses(id) ON DELETE CASCADE;
     ALTER TABLE lecturescribe_resources ADD CONSTRAINT fk_resources_course FOREIGN KEY (course_id) REFERENCES lecturescribe_courses(id) ON DELETE CASCADE;
     ALTER TABLE lecturescribe_course_quizzes ALTER COLUMN course_id SET NOT NULL, ADD CONSTRAINT fk_quizzes_course FOREIGN KEY (course_id) REFERENCES lecturescribe_courses(id) ON DELETE CASCADE;
     ```
   - Add B-Tree indexes on `course_id` across child tables for fast joins.

2. **Query & Code Cleanups**:
   - **Remove Regex Queries**: Remove runtime regex slug computation (`regexp_replace(LOWER(course_name), '[^a-z0-9]+', '-', 'g')`) in SQL queries; replace with indexed B-Tree lookups on `course_id = %s OR course_slug = %s`.
   - **Decommission `resolve_course_canonical_name`**: Replace the 4-table cascading fallback query with a single `SELECT * FROM lecturescribe_courses WHERE id = %s OR slug = %s`.
   - **Remove Frontend Title Heuristics**: Remove client-side formatting fallbacks in `useCourseDetail.js` (e.g. converting hyphens to title case) since canonical titles will be guaranteed by the API.

3. **Cache Key Standardization**:
   - Invalidate legacy cache keys and namespace all course caches deterministically by ID or slug (e.g., `ls:course:{course_id}:quiz` or `ls:course:{course_slug}:quiz`).


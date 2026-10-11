"""deprecate_legacy_summaries_table_and_add_sections_json

Revision ID: 0116eb2dda21
Revises: 8b42fca1e321
Create Date: 2026-10-11 13:22:43.443606

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0116eb2dda21'
down_revision: Union[str, Sequence[str], None] = '8b42fca1e321'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: Add sections_json to lecturescribe_lecture_summaries, backfill from lecturescribe_summaries, and drop legacy table."""
    op.execute("""
        -- 1. Ensure sections_json column exists on unified table
        ALTER TABLE lecturescribe_lecture_summaries
        ADD COLUMN IF NOT EXISTS sections_json JSONB DEFAULT '[]'::jsonb;

        -- 2. Migrate existing chapter sections from lecturescribe_summaries if present
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lecturescribe_summaries') THEN
                -- Update comprehensive summaries with legacy sections_json
                UPDATE lecturescribe_lecture_summaries ls
                SET sections_json = s.sections_json
                FROM (
                    SELECT DISTINCT ON (video_id) video_id, sections_json
                    FROM lecturescribe_summaries
                    ORDER BY video_id, id DESC
                ) s
                WHERE ls.video_id = s.video_id
                  AND (ls.sections_json IS NULL OR ls.sections_json = '[]'::jsonb);

                -- For any videos that ONLY have entries in lecturescribe_summaries, insert placeholder comprehensive record
                INSERT INTO lecturescribe_lecture_summaries (
                    video_id, summary_type, markdown_text, submission_text, sections_json, is_outdated
                )
                SELECT DISTINCT ON (video_id)
                    video_id,
                    'comprehensive',
                    '',
                    '',
                    sections_json,
                    COALESCE(is_outdated, FALSE)
                FROM lecturescribe_summaries s
                WHERE NOT EXISTS (
                    SELECT 1 FROM lecturescribe_lecture_summaries ls2
                    WHERE ls2.video_id = s.video_id
                )
                ORDER BY video_id, id DESC
                ON CONFLICT (video_id, COALESCE(user_email, ''), summary_type) DO UPDATE
                SET sections_json = EXCLUDED.sections_json;

                -- 3. Drop legacy table
                DROP TABLE IF EXISTS lecturescribe_summaries CASCADE;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    """Downgrade schema: Recreate lecturescribe_summaries and populate from sections_json."""
    op.execute("""
        CREATE TABLE IF NOT EXISTS lecturescribe_summaries (
            id SERIAL PRIMARY KEY,
            video_id VARCHAR(128) REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
            sections_json JSONB NOT NULL,
            is_outdated BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO lecturescribe_summaries (video_id, sections_json, is_outdated)
        SELECT video_id, sections_json, is_outdated
        FROM lecturescribe_lecture_summaries
        WHERE sections_json IS NOT NULL AND sections_json != '[]'::jsonb;

        ALTER TABLE lecturescribe_lecture_summaries DROP COLUMN IF EXISTS sections_json;
    """)

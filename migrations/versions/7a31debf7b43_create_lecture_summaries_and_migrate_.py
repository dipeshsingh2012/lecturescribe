"""create_lecture_summaries_and_migrate_data

Revision ID: 7a31debf7b43
Revises: 
Create Date: 2026-10-08 09:11:21.922233

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7a31debf7b43'
down_revision: Union[str, Sequence[str], None] = '91fbe5bfb99f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: Create lecturescribe_lecture_summaries and migrate data."""
    op.execute("""
        CREATE TABLE IF NOT EXISTS lecturescribe_lecture_summaries (
            id SERIAL PRIMARY KEY,
            video_id VARCHAR(128) NOT NULL REFERENCES lecturescribe_videos(video_id) ON DELETE CASCADE,
            user_email VARCHAR(255),
            summary_type VARCHAR(64) NOT NULL,
            markdown_text TEXT NOT NULL,
            submission_text TEXT DEFAULT '',
            citations_json JSONB DEFAULT '[]'::jsonb,
            word_count INT DEFAULT 0,
            model VARCHAR(128) DEFAULT '',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS uq_lecture_summaries_key 
            ON lecturescribe_lecture_summaries (video_id, COALESCE(user_email, ''), summary_type);

        CREATE INDEX IF NOT EXISTS idx_lecture_summaries_vid 
            ON lecturescribe_lecture_summaries (video_id);

        -- Migrate existing summaries from chat logs (most recent per video, email, and type)
        INSERT INTO lecturescribe_lecture_summaries (
            video_id, user_email, summary_type, markdown_text, submission_text, citations_json, word_count, model, created_at, updated_at
        )
        SELECT DISTINCT ON (video_id, COALESCE(user_email, ''), CASE WHEN user_prompt ILIKE '%15 min%' THEN '15_min' ELSE 'comprehensive' END)
            video_id,
            user_email,
            CASE WHEN user_prompt ILIKE '%15 min%' THEN '15_min' ELSE 'comprehensive' END AS summary_type,
            ai_reply AS markdown_text,
            COALESCE(submission_text, '') AS submission_text,
            citations_json,
            COALESCE(array_length(regexp_split_to_array(trim(COALESCE(submission_text, ai_reply)), '\\s+'), 1), 0) AS word_count,
            COALESCE(model, '') AS model,
            created_at,
            created_at AS updated_at
        FROM lecturescribe_chat_logs
        WHERE user_prompt ILIKE '%summary%'
        ORDER BY video_id, COALESCE(user_email, ''), CASE WHEN user_prompt ILIKE '%15 min%' THEN '15_min' ELSE 'comprehensive' END, id DESC
        ON CONFLICT DO NOTHING;

        -- Remove migrated summary prompt turns from chat logs so chat thread is dedicated solely to discussions
        DELETE FROM lecturescribe_chat_logs WHERE user_prompt ILIKE '%summary%';
    """)


def downgrade() -> None:
    """Downgrade schema: Restore chat log summaries and drop table."""
    op.execute("""
        INSERT INTO lecturescribe_chat_logs (
            video_id, user_prompt, ai_reply, citations_json, user_email, submission_text, model, created_at
        )
        SELECT
            video_id,
            CASE WHEN summary_type = '15_min' THEN 'Create a summary for a 15 min read' ELSE 'Generate Full Comprehensive Summary' END,
            markdown_text,
            citations_json,
            user_email,
            submission_text,
            model,
            created_at
        FROM lecturescribe_lecture_summaries;

        DROP TABLE IF EXISTS lecturescribe_lecture_summaries CASCADE;
    """)

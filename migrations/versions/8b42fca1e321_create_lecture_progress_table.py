"""create_lecture_progress_table

Revision ID: 8b42fca1e321
Revises: 7a31debf7b43
Create Date: 2026-10-08 10:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8b42fca1e321'
down_revision: Union[str, Sequence[str], None] = '7a31debf7b43'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: Create lecturescribe_lecture_progress table."""
    op.execute("""
        CREATE TABLE IF NOT EXISTS lecturescribe_lecture_progress (
            id SERIAL PRIMARY KEY,
            video_id VARCHAR(128) NOT NULL,
            user_email VARCHAR(255) NOT NULL DEFAULT 'anonymous',
            last_timestamp VARCHAR(32) NOT NULL DEFAULT '00:00',
            last_seconds DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            duration_seconds DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            progress_percent DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            active_cue_idx INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            CONSTRAINT uq_lecture_progress_user_video UNIQUE (user_email, video_id)
        );

        CREATE INDEX IF NOT EXISTS idx_lecture_progress_user_email 
            ON lecturescribe_lecture_progress (user_email);

        CREATE INDEX IF NOT EXISTS idx_lecture_progress_video_id 
            ON lecturescribe_lecture_progress (video_id);
    """)


def downgrade() -> None:
    """Downgrade schema: Drop lecturescribe_lecture_progress table."""
    op.execute("DROP TABLE IF EXISTS lecturescribe_lecture_progress CASCADE;")


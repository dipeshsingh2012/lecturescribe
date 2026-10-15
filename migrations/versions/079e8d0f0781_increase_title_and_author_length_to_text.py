"""increase_title_and_author_length_to_text

Revision ID: 079e8d0f0781
Revises: 0116eb2dda21
Create Date: 2026-10-15 11:57:13.541900

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '079e8d0f0781'
down_revision: Union[str, Sequence[str], None] = '0116eb2dda21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Increase title and author columns to TEXT across readings and related tables."""
    op.execute("""
        ALTER TABLE lecturescribe_course_readings ALTER COLUMN title TYPE TEXT;
        ALTER TABLE lecturescribe_course_readings ALTER COLUMN author TYPE TEXT;
        ALTER TABLE lecturescribe_resources ALTER COLUMN title TYPE TEXT;
        ALTER TABLE lecturescribe_course_notes ALTER COLUMN title TYPE TEXT;
    """)


def downgrade() -> None:
    """Revert columns back to VARCHAR(255)."""
    op.execute("""
        ALTER TABLE lecturescribe_course_readings ALTER COLUMN title TYPE VARCHAR(255);
        ALTER TABLE lecturescribe_course_readings ALTER COLUMN author TYPE VARCHAR(255);
        ALTER TABLE lecturescribe_resources ALTER COLUMN title TYPE VARCHAR(255);
        ALTER TABLE lecturescribe_course_notes ALTER COLUMN title TYPE VARCHAR(255);
    """)

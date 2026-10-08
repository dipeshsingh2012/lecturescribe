"""initial_baseline

Revision ID: 91fbe5bfb99f
Revises: 
Create Date: 2026-10-08 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '91fbe5bfb99f'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Baseline schema."""
    pass


def downgrade() -> None:
    """Downgrade baseline."""
    pass


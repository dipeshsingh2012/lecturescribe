#!/usr/bin/env python3
"""
GCS Course Folder Consolidation & DB Migration Script
-----------------------------------------------------
Consolidates duplicate GCS course folders created by numeric prefixes (e.g. 11-, 14-, 17-, 19-)
into their canonical non-prefixed course folders, and updates corresponding blob references
in the PostgreSQL database.

Usage:
    python scripts/consolidate_gcs_course_buckets.py            # Dry-run mode (safe preview)
    python scripts/consolidate_gcs_course_buckets.py --execute  # Actually copy blobs and update DB
"""
import os
import sys
import re
import argparse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv
load_dotenv(REPO_ROOT / ".env")

from google.cloud import storage
import psycopg2
from psycopg2.extras import RealDictCursor

from backend.gcs_storage import gcs_storage_service, to_gcs_course_slug


def get_canonical_blob_name(old_blob_name: str) -> str:
    """Compute the canonical blob name by normalizing the course directory component."""
    if not old_blob_name.startswith("courses/"):
        return old_blob_name

    parts = old_blob_name.split("/", 2)
    if len(parts) < 3:
        return old_blob_name

    _, old_slug, rest = parts
    new_slug = to_gcs_course_slug(old_slug)
    if new_slug == old_slug:
        return old_blob_name

    return f"courses/{new_slug}/{rest}"


def run_consolidation(execute: bool = False):
    print("=" * 70)
    print("🚀 GCS COURSE FOLDER CONSOLIDATION & DATABASE MIGRATION")
    print(f"   Mode: {'EXECUTE (Live Changes)' if execute else 'DRY RUN (Preview Only)'}")
    print(f"   Bucket: {gcs_storage_service.bucket_name}")
    print("=" * 70)

    # 1. Connect to GCS
    client = storage.Client()
    bucket = client.bucket(gcs_storage_service.bucket_name)

    print("\n📦 Scanning GCS for prefixed course folders...")
    blobs = list(bucket.list_blobs(prefix="courses/"))
    print(f"   Total objects under courses/: {len(blobs)}")

    gcs_moves = []
    for blob in blobs:
        new_name = get_canonical_blob_name(blob.name)
        if new_name != blob.name:
            gcs_moves.append((blob, new_name))

    print(f"\n🔍 Found {len(gcs_moves)} GCS blobs requiring consolidation:")
    for b, new_name in gcs_moves:
        print(f"   FROM: {b.name}")
        print(f"     TO: {new_name}\n")

    # 2. Check Database for matching blob references
    db_url = os.getenv("DATABASE_URL")
    db_updates = []
    if db_url:
        try:
            conn = psycopg2.connect(db_url, cursor_factory=RealDictCursor)
            with conn.cursor() as cur:
                cur.execute("SELECT id, course_name, filename, blob_name FROM lecturescribe_resources;")
                resources = cur.fetchall()
                for r in resources:
                    old_b = r.get("blob_name") or ""
                    new_b = get_canonical_blob_name(old_b)
                    if new_b != old_b:
                        db_updates.append((r["id"], r["filename"], old_b, new_b))

                cur.execute("SELECT note_id, course_name, blob_name FROM lecturescribe_course_notes;")
                notes = cur.fetchall()
                for n in notes:
                    old_b = n.get("blob_name") or ""
                    new_b = get_canonical_blob_name(old_b)
                    if new_b != old_b:
                        db_updates.append((f"note_{n['note_id']}", "course_note", old_b, new_b))
            conn.close()
        except Exception as e:
            print(f"⚠️ [DB Notice] Could not read database: {e}")

    print(f"\n🗄️  Found {len(db_updates)} database records with prefixed blob references:")
    for item_id, name, old_b, new_b in db_updates:
        print(f"   ID {item_id} ({name}):\n     {old_b} -> {new_b}")

    if not execute:
        print("\n" + "=" * 70)
        print("💡 DRY RUN COMPLETED — NO CHANGES APPLIED.")
        print("   To execute this consolidation, run:")
        print("   python scripts/consolidate_gcs_course_buckets.py --execute")
        print("=" * 70)
        return

    # 3. Execute GCS Migrations
    print("\n" + "=" * 70)
    print("⚡ EXECUTING GCS OBJECT MIGRATION...")
    print("=" * 70)

    copied_count = 0
    deleted_count = 0
    for blob, new_name in gcs_moves:
        print(f"➡️  Copying: {blob.name} -> {new_name}...")
        bucket.copy_blob(blob, bucket, new_name)
        copied_count += 1
        print(f"🗑️  Deleting source: {blob.name}...")
        blob.delete()
        deleted_count += 1

    print(f"\n✅ GCS Migration complete: {copied_count} blobs copied, {deleted_count} source blobs removed.")

    # 4. Execute DB Migrations
    if db_updates and db_url:
        print("\n" + "=" * 70)
        print("⚡ EXECUTING POSTGRESQL DATABASE MIGRATION...")
        print("=" * 70)
        try:
            conn = psycopg2.connect(db_url)
            with conn:
                with conn.cursor() as cur:
                    res_updated = 0
                    notes_updated = 0
                    for item_id, _, old_b, new_b in db_updates:
                        if str(item_id).startswith("note_"):
                            nid = str(item_id).replace("note_", "")
                            cur.execute("""
                                UPDATE lecturescribe_course_notes
                                SET blob_name = %s
                                WHERE note_id = %s;
                            """, (new_b, nid))
                            notes_updated += cur.rowcount
                        else:
                            cur.execute("""
                                UPDATE lecturescribe_resources
                                SET blob_name = %s
                                WHERE id = %s;
                            """, (new_b, item_id))
                            res_updated += cur.rowcount
            conn.close()
            print(f"✅ DB Migration complete: {res_updated} resources and {notes_updated} course notes updated.")
        except Exception as e:
            print(f"❌ [DB Error] Failed to update database: {e}")

    print("\n🎉 ALL CONSOLIDATIONS COMPLETED SUCCESSFULLY!\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Consolidate duplicate GCS course folders.")
    parser.add_argument("--execute", action="store_true", help="Execute the migration (default is dry-run)")
    args = parser.parse_args()

    run_consolidation(execute=args.execute)


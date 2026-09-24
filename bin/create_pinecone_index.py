#!/usr/bin/env python3
"""
Create Pinecone Vector Index for LectureScribe
----------------------------------------------
Dimension: 768 (Matches dense transcript embedding model)
Metric: cosine
Spec: Serverless (aws/us-east-1)
"""
import os
import sys
from pathlib import Path

# Load .env
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(env_file)
    except ImportError:
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))

api_key = os.getenv("PINECONE_API_KEY", "")
index_name = os.getenv("PINECONE_INDEX", "lecturescribe-rag-index")

if not api_key:
    print("❌ Error: PINECONE_API_KEY is not set in .env")
    sys.exit(1)

try:
    from pinecone import Pinecone, ServerlessSpec
except ImportError:
    print("❌ Error: pinecone package is not installed. Run: pip install pinecone")
    sys.exit(1)

print(f"🌲 Connecting to Pinecone...")
pc = Pinecone(api_key=api_key)

existing_indexes = [idx.name for idx in pc.list_indexes()]
print(f"📋 Existing indexes: {existing_indexes}")

if index_name in existing_indexes:
    print(f"✅ Index '{index_name}' already exists and is ready for LectureScribe!")
else:
    print(f"🚀 Creating new Serverless Pinecone index: '{index_name}' (dimension=768, metric=cosine)...")
    try:
        pc.create_index(
            name=index_name,
            dimension=768,
            metric="cosine",
            spec=ServerlessSpec(cloud="aws", region="us-east-1")
        )
        print(f"✅ Successfully created Pinecone index: '{index_name}'!")
    except Exception as e:
        print(f"❌ Failed to create index: {e}")
        print("\n💡 You can also create it manually in the Pinecone Console:")
        print(f"   Name: {index_name}")
        print("   Dimensions: 768")
        print("   Metric: Cosine")

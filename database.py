import os
from pymongo import MongoClient
from dotenv import load_dotenv

# Environment variables load karein
load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")

if not MONGO_URI:
    print("[Database Warning] MONGO_URI env variable mein set nahi hai!")

try:
    # MongoDB Client initialization
    client = MongoClient(MONGO_URI)
    db = client['huzaifa_institute']
    
    # Collections (Variable names aligned with imports)
    courses_collection = db['courses']
    enrollments_collection = db['enrollments']
    
    print("[Python Agent] MongoDB Connected Successfully!")
except Exception as e:
    print(f"[Database Error] Mongo connection failed: {e}")

def get_db():
    """Database instance return karne ke liye helper function"""
    return db
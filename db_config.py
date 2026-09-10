import logging
from typing import Optional

from pymongo import MongoClient
from pymongo.database import Database

from services.settings import get_settings

logger = logging.getLogger(__name__)

_mongo_client: Optional[MongoClient] = None

def _init_mongo_client() -> MongoClient:
    settings = get_settings()
    uri = settings.mongodb_uri
    if not uri:
        raise ValueError("MONGODB_URI must be set.")
    
    # Try to connect
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        return client
    except Exception as exc:
        logger.error(f"Failed to connect to MongoDB: {exc}")
        raise RuntimeError(f"MongoDB connection failed: {exc}") from exc

def get_db() -> Database:
    """Returns the initialized MongoDB database instance."""
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = _init_mongo_client()
    return _mongo_client[get_settings().mongodb_db_name]

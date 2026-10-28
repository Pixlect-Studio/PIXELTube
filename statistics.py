"""Analytics and view tracking for PIXELTube, stored in Bunny Storage."""

import threading
import time
from typing import Any
from storage import get_file_json, save_file_json
from videos import load_all_videos

STATS_PATH = "Statistics/all_stats.json" 
_STATS_LOCK = threading.RLock()
_STATS_CACHE = {"data": None, "expires": 0}

def _read_all_stats() -> dict[str, Any]:
    # In-memory cache to prevent hitting Bunny on every page load
    if _STATS_CACHE["data"] and time.time() < _STATS_CACHE["expires"]:
        return _STATS_CACHE["data"]

    data = get_file_json(STATS_PATH) or {}
    _STATS_CACHE["data"] = data
    _STATS_CACHE["expires"] = time.time() + 5 # 5 second cache
    
    # Ensure every video in the index has an entry
    for video in load_all_videos():
        vid = video["id"]
        if vid not in data:
            data[vid] = {"views": 0, "likes": 0, "dislikes": 0}
    return data

def _write_all_stats(data: dict[str, Any]) -> None:
    _STATS_CACHE["data"] = data
    _STATS_CACHE["expires"] = time.time() + 5
    save_file_json(STATS_PATH, data)

def get_video_stats(video_id: str) -> dict[str, Any]:
    with _STATS_LOCK:
        data = _read_all_stats()
        return data.get(video_id, {"views": 0, "likes": 0, "dislikes": 0})

def increment_view(video_id: str) -> dict[str, Any]:
    with _STATS_LOCK:
        data = _read_all_stats()
        if video_id not in data:
            data[video_id] = {"views": 0, "likes": 0, "dislikes": 0}
        data[video_id]["views"] += 1
        _write_all_stats(data)
        return data[video_id]

def get_platform_stats() -> dict[str, Any]:
    videos = load_all_videos()
    return {
        "total_users": None,
        "total_videos": len(videos),
        "daily_views": None,
        "storage_used_tb": None,
    }
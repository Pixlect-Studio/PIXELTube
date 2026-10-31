"""Analytics and view tracking for PIXELTube, stored in Bunny Storage."""

import threading
from typing import Any

from storage import get_file_json, save_file_json
from videos import load_all_videos

STATS_DIR = "Statistics"
_STATS_LOCK = threading.RLock()


def _get_stats_key(video_id: str) -> str:
    return f"{STATS_DIR}/{video_id}.json"


def _read_video_stats(video_id: str) -> dict[str, Any]:
    data = get_file_json(_get_stats_key(video_id))
    if data is None:
        return {"views": 0, "likes": 0, "dislikes": 0}
    if not isinstance(data, dict):
        raise RuntimeError(f"Statistics for video {video_id} are malformed")
    return {
        **data,
        "views": max(0, int(data.get("views", 0))),
        "likes": max(0, int(data.get("likes", 0))),
        "dislikes": max(0, int(data.get("dislikes", 0))),
    }


def get_video_stats(video_id: str) -> dict[str, Any]:
    """Retrieve view and reaction statistics for one video."""
    return _read_video_stats(video_id)


def increment_view(video_id: str) -> dict[str, Any]:
    """Increment and persist a video's view count in Bunny Storage."""
    with _STATS_LOCK:
        stats = _read_video_stats(video_id)
        stats["views"] += 1
        if not save_file_json(_get_stats_key(video_id), stats):
            raise RuntimeError("Bunny Storage rejected the view-count update")
        return stats


def get_platform_stats() -> dict[str, Any]:
    """Retrieve platform metrics, using the video index for the video count."""
    data = get_file_json(f"{STATS_DIR}/platform.json")
    if isinstance(data, dict):
        return data

    videos = load_all_videos()
    return {
        "total_users": None,
        "total_videos": len(videos),
        "daily_views": None,
        "storage_used_tb": None,
    }

"""
feed.py — Builds the PIXELTube home page feed.
Combines video metadata with real-time statistics.
"""
from typing import List, Dict
from videos import load_all_videos
from statistics import get_video_stats

def get_home_feed(category: str = None, limit: int = 50) -> List[Dict]:
    """
    Returns a sorted feed of videos ready for the UI.
    Sorts by newest first.
    """
    videos = load_all_videos()
    
    # Filter by category if requested
    if category and category.lower() != "all":
        videos = [v for v in videos if v.get("category", "").lower() == category.lower()]

    # Enrich with statistics
    for v in videos:
        stats = get_video_stats(v["id"])
        v["views"] = stats.get("views", 0)
        v["likes"] = stats.get("likes", 0)

    # Sort by created_at descending (newest first)
    videos.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    
    return videos[:limit]

def get_trending_feed(limit: int = 10) -> List[Dict]:
    """
    Returns the most viewed videos.
    """
    videos = load_all_videos()
    
    for v in videos:
        stats = get_video_stats(v["id"])
        v["views"] = stats.get("views", 0)

    # Sort by views descending
    videos.sort(key=lambda x: x.get("views", 0), reverse=True)
    
    return videos[:limit]

def get_related_videos(video_id: str, limit: int = 8) -> List[Dict]:
    """
    Returns videos related to the one currently being watched (same category).
    """
    all_videos = load_all_videos()
    
    current_video = next((v for v in all_videos if v["id"] == video_id), None)
    if not current_video:
        return get_home_feed(limit=limit)

    current_category = current_video.get("category", "General")
    
    # Filter to same category, excluding the current video
    related = [
        v for v in all_videos 
        if v["id"] != video_id and v.get("category") == current_category
    ]
    
    # If we don't have enough, pad with general videos
    if len(related) < limit:
        pad = [v for v in all_videos if v["id"] != video_id and v not in related]
        related.extend(pad)
        
    return related[:limit]
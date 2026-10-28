"""
feed.py — Builds the PIXELTube feeds, including AI-recommended Shorts.
"""
import random
from typing import List, Dict
from videos import load_all_videos
from statistics import _read_all_stats

def get_home_feed(category: str = None, limit: int = 50) -> List[Dict]:
    videos = load_all_videos()
    if category and category.lower() != "all":
        videos = [v for v in videos if v.get("category", "").lower() == category.lower()]

    all_stats = _read_all_stats()
    for v in videos:
        stats = all_stats.get(v["id"], {"views": 0})
        v["views"] = stats.get("views", 0)

    videos.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return videos[:limit]

def get_trending_feed(limit: int = 10) -> List[Dict]:
    videos = load_all_videos()
    all_stats = _read_all_stats()
    for v in videos:
        stats = all_stats.get(v["id"], {"views": 0})
        v["views"] = stats.get("views", 0)

    videos.sort(key=lambda x: x.get("views", 0), reverse=True)
    return videos[:limit]

def get_ai_shorts(user_id: str = None, limit: int = 20) -> List[Dict]:
    """
    AI Recommendation Engine for Shorts.
    Scores Minis based on:
    - User's explicit likes (+100 points)
    - User's watch history (+10 points)
    - Categories the user interacts with (+50 points)
    - Global popularity (Views / 10)
    - A random jitter so the feed refreshes every time
    """
    import social
    
    videos = [v for v in load_all_videos() if v.get("video_type") in ("mini", "short")]
    all_stats = _read_all_stats()
    
    # Get user activity if signed in
    liked_videos = set()
    watch_history = set()
    liked_categories = {}
    
    if user_id:
        try:
            activity = social.get_user_activity(user_id)
            liked_videos = set(activity.get("liked", []))
            watch_history = set(activity.get("history", []))
            
            # Analyze which categories the user likes most
            all_videos_dict = {v["id"]: v for v in load_all_videos()}
            for vid in liked_videos:
                if vid in all_videos_dict:
                    cat = all_videos_dict[vid].get("category", "General")
                    liked_categories[cat] = liked_categories.get(cat, 0) + 1
        except Exception as e:
            print(f"AI Feed: Could not load user activity for {user_id}: {e}")

    # Score every video
    scored_videos = []
    for v in videos:
        score = 0.0
        
        # 1. Base Popularity Score (Views / 10) + Likes
        stats = all_stats.get(v["id"], {"views": 0, "likes": 0})
        score += (stats.get("views", 0) / 10.0)
        score += (stats.get("likes", 0) * 2)
        
        # 2. User Preference Boosts
        if v["id"] in liked_videos:
            score += 100.0  # Show them what they liked
        elif v["id"] in watch_history:
            score -= 20.0   # Don't show them what they just watched
            
        # 3. Category Affinity
        category = v.get("category", "General")
        if category in liked_categories:
            score += (liked_categories[category] * 50.0)
            
        # 4. Random Jitter (keeps the feed fresh)
        score += random.uniform(0, 30)
        
        v["views"] = stats.get("views", 0)
        v["likes"] = stats.get("likes", 0)
        scored_videos.append({"score": score, "video": v})

    # Sort by highest score
    scored_videos.sort(key=lambda x: x["score"], reverse=True)
    
    return [item["video"] for item in scored_videos][:limit]
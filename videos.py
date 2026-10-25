"""
videos.py — Video metadata manager for PIXELTube.
Reads the master videos.json from Bunny Storage (or local fallback).
"""
import os
import json
import requests
from typing import List, Dict

from storage import STORAGE_BASE, BUNNY_STORAGE_ZONE, BUNNY_ACCESS_KEY, CDN_BASE

VIDEOS_INDEX_PATH = "videos/index.json"
LOCAL_INDEX_PATH = "videos_index.json" # Local fallback for dev

def _get_bunny_headers() -> dict:
    return {"AccessKey": BUNNY_ACCESS_KEY}

def _build_public_url(remote_path: str) -> str:
    if not remote_path:
        return ""
    return f"{CDN_BASE.rstrip('/')}/{remote_path.lstrip('/')}"

def load_all_videos() -> List[Dict]:
    """
    Loads the master list of videos from Bunny Storage.
    Falls back to a local file if Bunny is unreachable.
    """
    videos = []
    
    # 1. Try Bunny Storage
    try:
        url = f"{STORAGE_BASE}/{BUNNY_STORAGE_ZONE}/{VIDEOS_INDEX_PATH}"
        r = requests.get(url, headers=_get_bunny_headers(), timeout=5)
        if r.status_code == 200:
            videos = r.json()
            # Ensure URLs are up-to-date
            for v in videos:
                if 'remote_path' in v:
                    v['url'] = _build_public_url(v['remote_path'])
            return videos
    except requests.RequestException:
        pass # Fall through to local fallback

    # 2. Local fallback
    if os.path.exists(LOCAL_INDEX_PATH):
        try:
            with open(LOCAL_INDEX_PATH, 'r') as f:
                videos = json.load(f)
        except json.JSONDecodeError:
            pass
            
    return videos

def save_video_index(videos: List[Dict]) -> bool:
    """
    Saves the master video index to Bunny Storage.
    Also writes a local copy for fallback.
    """
    # 1. Write local copy
    try:
        with open(LOCAL_INDEX_PATH, 'w') as f:
            json.dump(videos, f, indent=2)
    except Exception as e:
        print(f"Warning: Failed to save local index: {e}")

    # 2. Write to Bunny
    url = f"{STORAGE_BASE}/{BUNNY_STORAGE_ZONE}/{VIDEOS_INDEX_PATH}"
    try:
        r = requests.put(
            url,
            headers=_get_bunny_headers(),
            data=json.dumps(videos, indent=2).encode('utf-8'),
            timeout=10
        )
        return r.status_code in (200, 201)
    except requests.RequestException as e:
        print(f"Error saving video index to Bunny: {e}")
        return False

def get_video(video_id: str) -> Dict | None:
    """Fetch a single video by ID."""
    videos = load_all_videos()
    for v in videos:
        if v.get("id") == video_id:
            return v
    return None
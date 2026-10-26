"""Persistent PIXELTube user and social data stored in Bunny Storage."""

import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from storage import get_file_json, save_file_json

SOCIAL_DATA_PATH = "Social/data.json"
USER_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_STORE_LOCK = threading.RLock()

# 10-second cache to prevent downloading/uploading the entire social database
# on every single page load or click, which was causing massive delays.
_STORE_CACHE = {"data": None, "expires": 0}


def _empty_store() -> dict[str, Any]:
    return {
        "version": 1,
        "users": {},
        "videos": {},
        "subscriptions": {},
        "history": {},
        "notifications": {},
    }


def validate_user_id(user_id: str) -> str:
    value = str(user_id or "").strip()
    if not USER_ID_PATTERN.fullmatch(value):
        raise ValueError("A valid PIXLECT user ID is required")
    return value


def _read_store() -> dict[str, Any]:
    # Return from memory if cache is still fresh
    if _STORE_CACHE["data"] and time.time() < _STORE_CACHE["expires"]:
        return _STORE_CACHE["data"]

    data = get_file_json(SOCIAL_DATA_PATH)
    if data is None:
        data = _empty_store()
    elif not isinstance(data, dict) or data.get("version") != 1:
        raise RuntimeError("Bunny social data is malformed or uses an unsupported version")
    
    # Ensure all required collections exist
    for key in ("users", "videos", "subscriptions", "history", "notifications"):
        if not isinstance(data.get(key), dict):
            raise RuntimeError(f"Bunny social data is missing a valid {key} collection")
            
    _STORE_CACHE["data"] = data
    _STORE_CACHE["expires"] = time.time() + 10
    return data


def _write_store(data: dict[str, Any]) -> None:
    # Update memory cache instantly
    _STORE_CACHE["data"] = data
    _STORE_CACHE["expires"] = time.time() + 10
    
    if not save_file_json(SOCIAL_DATA_PATH, data):
        raise RuntimeError("Bunny Storage rejected the social data update")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_video(data: dict[str, Any], video_id: str) -> dict[str, Any]:
    video = data["videos"].setdefault(
        video_id,
        {"owner_id": None, "reactions": {}, "comments": []},
    )
    if not isinstance(video, dict):
        raise RuntimeError("Bunny social data contains an invalid video record")
    video.setdefault("owner_id", None)
    video.setdefault("reactions", {})
    video.setdefault("comments", [])
    return video


def _ensure_user(data: dict[str, Any], user_id: str) -> dict[str, Any]:
    data["users"].setdefault(user_id, {"id": user_id, "username": "PIXLECT User"})
    data["subscriptions"].setdefault(user_id, [])
    data["history"].setdefault(user_id, [])
    data["notifications"].setdefault(user_id, [])
    return data["users"][user_id]


def _notify(data: dict[str, Any], user_id: str | None, message: str) -> None:
    if not user_id:
        return
    _ensure_user(data, user_id)
    notifications = data["notifications"][user_id]
    notifications.insert(0, {
        "id": uuid.uuid4().hex,
        "text": message[:500],
        "created_at": _now(),
        "read": False,
    })
    del notifications[100:]


def upsert_user(
    user_id: str,
    username: str,
    channel: str = "",
    icon: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user_id = validate_user_id(user_id)
    username = str(username or "").strip()
    channel = str(channel or "").strip()
    if not username or len(username) > 50:
        raise ValueError("Username must contain 1 to 50 characters")
    if len(channel) > 50:
        raise ValueError("Channel name must be 50 characters or fewer")

    with _STORE_LOCK:
        data = _read_store()
        user = _ensure_user(data, user_id)
        user.update({
            "id": user_id,
            "username": username,
            "channel": channel,
            "updated_at": _now(),
        })
        if isinstance(icon, dict):
            user["icon"] = {
                key: str(icon[key])[:100]
                for key in ("emoji", "bg", "shape")
                if isinstance(icon.get(key), str)
            }
        _write_store(data)
        return dict(user)


def get_user(user_id: str) -> dict[str, Any] | None:
    user_id = validate_user_id(user_id)
    with _STORE_LOCK:
        data = _read_store()
        user = data["users"].get(user_id)
        return dict(user) if user else None


def register_video_owner(
    video_id: str,
    user_id: str | None,
    username: str,
) -> None:
    with _STORE_LOCK:
        data = _read_store()
        video = _ensure_video(data, video_id)
        if user_id:
            user_id = validate_user_id(user_id)
            _ensure_user(data, user_id)
            video["owner_id"] = user_id
        video["owner_name"] = str(username or "Creator")[:50]
        _write_store(data)


def get_video_social(
    video_id: str,
    user_id: str | None = None,
    owner_id: str | None = None,
    owner_name: str | None = None,
) -> dict[str, Any]:
    if user_id:
        user_id = validate_user_id(user_id)
    if owner_id:
        owner_id = validate_user_id(owner_id)
        
    with _STORE_LOCK:
        data = _read_store()
        video = _ensure_video(data, video_id)
        reaction_counts = {"likes": 0, "dislikes": 0}
        for reaction in video["reactions"].values():
            if reaction == "like":
                reaction_counts["likes"] += 1
            elif reaction == "dislike":
                reaction_counts["dislikes"] += 1

        resolved_owner_id = owner_id or video.get("owner_id")
        owner = data["users"].get(resolved_owner_id) if resolved_owner_id else None
        
        subscriber_count = sum(
            1 for subscriptions in data["subscriptions"].values()
            if resolved_owner_id and resolved_owner_id in subscriptions
        )
        
        return {
            **reaction_counts,
            "reaction": video["reactions"].get(user_id) if user_id else None,
            "comments": list(video["comments"]),
            "creator": {
                "id": resolved_owner_id,
                "name": (owner or {}).get("channel") or owner_name or (owner or {}).get("username") or video.get("owner_name", "Creator"),
            } if resolved_owner_id or owner_name or video.get("owner_name") else None,
            "subscribed": bool(
                user_id and resolved_owner_id
                and resolved_owner_id in data["subscriptions"].get(user_id, [])
            ),
            "canSubscribe": bool(user_id and resolved_owner_id and user_id != resolved_owner_id),
            "subscriber_count": subscriber_count,
        }


def set_reaction(user_id: str, username: str, video_id: str, reaction: str) -> dict[str, Any]:
    user_id = validate_user_id(user_id)
    if reaction not in ("like", "dislike"):
        raise ValueError("Reaction must be 'like' or 'dislike'")

    with _STORE_LOCK:
        data = _read_store()
        video = _ensure_video(data, video_id)
        _ensure_user(data, user_id)
        
        current = video["reactions"].get(user_id)
        if current == reaction:
            video["reactions"].pop(user_id)
        else:
            video["reactions"][user_id] = reaction
            
        owner_id = video.get("owner_id")
        if owner_id and owner_id != user_id and video["reactions"].get(user_id) == "like":
            _notify(data, owner_id, f"{username} liked your video.")
            
        _write_store(data)
    return get_video_social(video_id, user_id)


def add_comment(user_id: str, username: str, video_id: str, text: str) -> dict[str, Any]:
    user_id = validate_user_id(user_id)
    text = str(text or "").strip()
    if not text or len(text) > 2000:
        raise ValueError("Comments must contain 1 to 2,000 characters")
        
    comment = {
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "username": str(username or "PIXLECT User")[:50],
        "text": text,
        "created_at": _now(),
    }
    
    with _STORE_LOCK:
        data = _read_store()
        video = _ensure_video(data, video_id)
        _ensure_user(data, user_id)
        
        video["comments"].insert(0, comment)
        del video["comments"][500:] # Keep max 500 comments per video
        
        owner_id = video.get("owner_id")
        if owner_id and owner_id != user_id:
            _notify(data, owner_id, f"{comment['username']} commented on your video.")
            
        _write_store(data)
    return comment


def toggle_subscription(user_id: str, username: str, creator_id: str) -> dict[str, Any]:
    user_id = validate_user_id(user_id)
    creator_id = validate_user_id(creator_id)
    
    if user_id == creator_id:
        raise ValueError("You cannot subscribe to your own channel")
        
    with _STORE_LOCK:
        data = _read_store()
        _ensure_user(data, user_id)
        
        subscriptions = data["subscriptions"][user_id]
        subscribed = creator_id not in subscriptions
        
        if subscribed:
            subscriptions.append(creator_id)
            _notify(data, creator_id, f"{username} subscribed to your channel.")
        else:
            subscriptions.remove(creator_id)
            
        _write_store(data)
        count = sum(1 for items in data["subscriptions"].values() if creator_id in items)
        
    return {"subscribed": subscribed, "subscriber_count": count}


def record_view(user_id: str | None, video_id: str) -> None:
    if not user_id:
        return
    user_id = validate_user_id(user_id)
    
    with _STORE_LOCK:
        data = _read_store()
        _ensure_user(data, user_id)
        
        history = data["history"][user_id]
        history[:] = [video_id, *[item for item in history if item != video_id]][:100]
        _write_store(data)


def get_user_activity(user_id: str) -> dict[str, Any]:
    user_id = validate_user_id(user_id)
    
    with _STORE_LOCK:
        data = _read_store()
        reactions = [
            video_id for video_id, video in data["videos"].items()
            if video.get("reactions", {}).get(user_id) == "like"
        ]
        return {
            "history": list(data["history"].get(user_id, [])),
            "liked": reactions,
            "subscriptions": list(data["subscriptions"].get(user_id, [])),
            "notifications": list(data["notifications"].get(user_id, [])),
        }


def mark_notifications_read(user_id: str) -> None:
    user_id = validate_user_id(user_id)
    
    with _STORE_LOCK:
        data = _read_store()
        for notification in data["notifications"].get(user_id, []):
            notification["read"] = True
        _write_store(data)
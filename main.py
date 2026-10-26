"""
main.py — PIXELTube dev server + API.
"""
import os
import re
import uuid
import tempfile
import threading
from datetime import datetime
from pathlib import Path

import requests
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from storage import (
    upload_video, delete_video, file_exists,
    STORAGE_BASE, BUNNY_STORAGE_ZONE, BUNNY_ACCESS_KEY, CDN_BASE,
)
from videos import load_all_videos, save_video_index, get_video
from statistics import get_video_stats, increment_view, get_platform_stats
from feed import get_home_feed, get_trending_feed
import social

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
STATIC_DIR = Path(__file__).parent / "static"

TMP_DIR = os.getenv("TMPDIR", "/tmp")
if not os.path.isdir(TMP_DIR):
    TMP_DIR = tempfile.gettempdir()

ALLOWED_ORIGIN_REGEX = r"https://.*\.vercel\.app"
_INDEX_LOCK = threading.RLock()

app = FastAPI(title="PIXELTube Dev Server", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:5500", "http://127.0.0.1:5500"],
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _validate_upload_meta(title, description, category, visibility, channel, creator_name, video_type, creator_id):
    channel = str(channel or "").strip()
    creator_name = str(creator_name or "").strip()
    title = (str(title or "").strip() or "Untitled")[:200]
    if not channel: raise HTTPException(400, "Set a channel name in Settings before uploading")
    if len(channel) > 50: raise HTTPException(400, "Channel name must be 50 characters or fewer")
    if len(creator_name) > 50: raise HTTPException(400, "Display name must be 50 characters or fewer")

    if video_type == "short": video_type = "mini"
    elif video_type == "video": video_type = "long"
    if video_type not in ("long", "mini"): raise HTTPException(400, "Video type must be 'long' or 'mini'")

    creator_id = str(creator_id or "").strip()
    if creator_id:
        try: creator_id = social.validate_user_id(creator_id)
        except ValueError as exc: raise HTTPException(400, str(exc)) from exc

    return {
        "title": title, "description": str(description or "")[:5000],
        "category": str(category or "General")[:50], "visibility": str(visibility or "Public")[:20],
        "channel": channel, "creator_name": creator_name,
        "creator_id": creator_id or None, "video_type": video_type,
    }

@app.get("/api/health")
def health(): return {"status": "ok", "app": "PIXELTube"}

@app.get("/api/videos")
def api_list_videos(category: str = None): return {"count": len(get_home_feed(category=category)), "videos": get_home_feed(category=category)}

@app.get("/api/videos/trending")
def api_trending_videos(): return {"count": len(get_trending_feed()), "videos": get_trending_feed()}

@app.get("/api/videos/{video_id}")
def api_get_video(video_id: str):
    video = get_video(video_id)
    if not video: raise HTTPException(404, "Video not found")
    try:
        stats = get_video_stats(video_id)
        social_stats = social.get_video_social(video_id, owner_id=video.get("creator_id"), owner_name=video.get("channel") or video.get("creator_name"))
    except RuntimeError as exc: raise HTTPException(502, str(exc)) from exc
    video["views"] = stats.get("views", 0)
    video["likes"] = social_stats["likes"]
    video["dislikes"] = social_stats["dislikes"]
    return video

@app.post("/api/videos/{video_id}/view")
def api_add_view(video_id: str, payload: dict = Body(default={})):
    video = get_video(video_id)
    if not video: raise HTTPException(404, "Video not found")
    try:
        new_stats = increment_view(video_id)
        social.record_view(payload.get("user_id"), video_id)
    except requests.RequestException as exc: raise HTTPException(502, "Could not save video view statistics") from exc
    except (RuntimeError, ValueError) as exc: raise HTTPException(502 if isinstance(exc, RuntimeError) else 400, str(exc)) from exc
    return {"success": True, "stats": new_stats}

@app.get("/api/videos/{video_id}/social")
def api_get_video_social(video_id: str, user_id: str = None):
    video = get_video(video_id)
    if not video: raise HTTPException(404, "Video not found")
    try: return social.get_video_social(video_id, user_id, owner_id=video.get("creator_id"), owner_name=video.get("channel") or video.get("creator_name"))
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc: raise HTTPException(502, str(exc)) from exc

@app.post("/api/videos/{video_id}/reaction")
def api_set_video_reaction(video_id: str, payload: dict = Body(...)):
    video = get_video(video_id)
    if not video: raise HTTPException(404, "Video not found")
    try:
        user_id = social.validate_user_id(payload.get("user_id"))
        user = social.get_user(user_id)
        if not user: user = social.upsert_user(user_id, "PIXLECT user")
        
        if video.get("creator_id"):
            social.register_video_owner(video_id, video["creator_id"], video.get("channel") or video.get("creator_name") or "Creator")
        return social.set_reaction(user_id, user.get("username", "PIXLECT user"), video_id, payload.get("reaction"))
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc: raise HTTPException(502, str(exc)) from exc

@app.post("/api/videos/{video_id}/comments")
def api_add_video_comment(video_id: str, payload: dict = Body(...)):
    video = get_video(video_id)
    if not video: raise HTTPException(404, "Video not found")
    try:
        user_id = social.validate_user_id(payload.get("user_id"))
        user = social.get_user(user_id)
        if not user: user = social.upsert_user(user_id, "PIXLECT user")

        if video.get("creator_id"):
            social.register_video_owner(video_id, video["creator_id"], video.get("channel") or video.get("creator_name") or "Creator")
        return social.add_comment(user_id, user.get("username", "PIXLECT user"), video_id, payload.get("text"))
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc: raise HTTPException(502, str(exc)) from exc

@app.post("/api/videos/{video_id}/subscriptions")
def api_toggle_subscription(video_id: str, payload: dict = Body(...)):
    video = get_video(video_id)
    if not video: raise HTTPException(404, "Video not found")
    creator_id = video.get("creator_id")
    if not creator_id: raise HTTPException(400, "This video has no PIXLECT creator ID")
    try:
        user_id = social.validate_user_id(payload.get("user_id"))
        user = social.get_user(user_id)
        if not user: user = social.upsert_user(user_id, "PIXLECT user")

        social.register_video_owner(video_id, creator_id, video.get("channel") or video.get("creator_name") or "Creator")
        return social.toggle_subscription(user_id, user.get("username", "PIXLECT user"), creator_id)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc: raise HTTPException(502, str(exc)) from exc

@app.post("/api/users/sync")
def api_sync_user(payload: dict = Body(...)):
    try: return {"success": True, "user": social.upsert_user(payload.get("user_id"), payload.get("username"), payload.get("channel", ""), payload.get("icon"))}
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc: raise HTTPException(502, str(exc)) from exc

@app.get("/api/users/{user_id}/activity")
def api_get_user_activity(user_id: str):
    try: return social.get_user_activity(user_id)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc: raise HTTPException(502, str(exc)) from exc

@app.post("/api/users/{user_id}/notifications/read")
def api_mark_notifications_read(user_id: str):
    try:
        social.mark_notifications_read(user_id)
        return {"success": True}
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc: raise HTTPException(502, str(exc)) from exc

@app.post("/api/upload/init")
async def api_upload_init(title: str = Form("Untitled"), description: str = Form(""), category: str = Form("General"), visibility: str = Form("Public"), channel: str = Form(...), creator_name: str = Form(""), video_type: str = Form("video"), creator_id: str = Form(""), filename: str = Form(...), content_type: str = Form("video/mp4")):
    if not BUNNY_ACCESS_KEY: raise HTTPException(500, "Server is not configured for uploads")
    meta = _validate_upload_meta(title, description, category, visibility, channel, creator_name, video_type, creator_id)
    ext = os.path.splitext(filename)[1].lower() or ".mp4"
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", ext): ext = ".mp4"
    video_id = uuid.uuid4().hex
    remote_path = f"videos/{video_id}{ext}"
    upload_url = f"{STORAGE_BASE}/{BUNNY_STORAGE_ZONE}/{remote_path}"
    public_url = f"{CDN_BASE.rstrip('/')}/{remote_path}" if CDN_BASE else ""
    return {"video_id": video_id, "remote_path": remote_path, "upload_url": upload_url, "public_url": public_url, "headers": {"AccessKey": BUNNY_ACCESS_KEY, "Content-Type": content_type or "video/mp4"}, "meta": meta}

@app.post("/api/upload/complete")
async def api_upload_complete(payload: dict = Body(...)):
    video_id = str(payload.get("video_id", "")).strip()
    remote_path = str(payload.get("remote_path", "")).strip()
    meta_in = payload.get("meta") or {}
    if not re.fullmatch(r"[a-f0-9]{32}", video_id): raise HTTPException(400, "Invalid video_id")
    if not remote_path.startswith(f"videos/{video_id}") or ".." in remote_path: raise HTTPException(400, "Invalid remote_path")
    meta = _validate_upload_meta(meta_in.get("title", "Untitled"), meta_in.get("description", ""), meta_in.get("category", "General"), meta_in.get("visibility", "Public"), meta_in.get("channel", ""), meta_in.get("creator_name", ""), meta_in.get("video_type", "long"), meta_in.get("creator_id", ""))
    if not file_exists(remote_path): raise HTTPException(400, "Upload not found in storage.")
    public_url = f"{CDN_BASE.rstrip('/')}/{remote_path}" if CDN_BASE else ""
    video = {"id": video_id, **meta, "url": public_url, "remote_path": remote_path, "created_at": datetime.utcnow().isoformat() + "Z", "status": "Active"}
    with _INDEX_LOCK:
        videos = load_all_videos()
        existing = next((v for v in videos if v.get("id") == video_id), None)
        if existing: return JSONResponse(existing, status_code=200)
        videos.append(video)
        if not save_video_index(videos): raise HTTPException(502, "Video uploaded but its index could not be saved")
    if meta["creator_id"]:
        try: social.register_video_owner(video_id, meta["creator_id"], meta["channel"] or meta["creator_name"])
        except (RuntimeError, ValueError) as exc: raise HTTPException(502, f"Creator profile could not be saved: {exc}") from exc
    return JSONResponse(video, status_code=201)

@app.delete("/api/videos/{video_id}")
def api_delete_video(video_id: str):
    videos = load_all_videos()
    target = next((v for v in videos if v["id"] == video_id), None)
    if not target: raise HTTPException(404, "Video not found")
    result = delete_video(target["remote_path"])
    if not result["success"]: raise HTTPException(502, f"Bunny delete failed: {result['message']}")
    with _INDEX_LOCK:
        videos = [v for v in load_all_videos() if v["id"] != video_id]
        if not save_video_index(videos): raise HTTPException(502, "Video index could not be saved")
    return {"success": True, "id": video_id}

@app.get("/api/admin/stats")
def api_admin_stats(): return get_platform_stats()

if STATIC_DIR.exists(): app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
else: print(f"[warn] static/ not found at {STATIC_DIR}; serving API only")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, reload=False, log_level="info")
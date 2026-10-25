"""
main.py — PIXELTube dev server + API.

Run locally:
    pip install -r requirements.txt
    python main.py

Deploy on Vercel:
    vercel --prod
    (uses vercel.json -> @vercel/python, entrypoint = app in main.py)

Endpoints:
    GET  /api/health
    GET  /api/videos             (Home feed, supports ?category=Gaming)
    GET  /api/videos/trending    (Trending feed)
    GET  /api/videos/{id}        (Single video details)
    POST /api/videos/{id}/view   (Increment view count)
    POST /api/upload             (Upload new video)
    DELETE /api/videos/{id}      (Delete video)
    GET  /api/admin/stats        (Platform stats for admin dashboard)
"""

import os
import uuid
import tempfile
from datetime import datetime
from pathlib import Path

import requests
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Core Storage & Data Modules
from storage import upload_video, delete_video
from videos import load_all_videos, save_video_index, get_video
from statistics import get_video_stats, increment_view, get_platform_stats
from feed import get_home_feed, get_trending_feed
import social

# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
STATIC_DIR = Path(__file__).parent / "static"

# Vercel's filesystem is read-only except /tmp. Use TMPDIR when present
# so local dev and serverless both work.
TMP_DIR = os.getenv("TMPDIR", "/tmp")
if not os.path.isdir(TMP_DIR):
    TMP_DIR = tempfile.gettempdir()

# CORS: allow local dev + any Vercel preview/prod domain.
# We use a regex so preview deployments (*.vercel.app) are also allowed.
ALLOWED_ORIGIN_REGEX = r"https://.*\.vercel\.app"

# ------------------------------------------------------------------
# App setup
# ------------------------------------------------------------------
app = FastAPI(title="PIXELTube Dev Server", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------
# API Routes
# ------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "app": "PIXELTube"}

# ---------------- FEEDS ----------------

@app.get("/api/videos")
def api_list_videos(category: str = None):
    """Home feed, optionally filtered by category."""
    videos = get_home_feed(category=category)
    return {"count": len(videos), "videos": videos}


@app.get("/api/videos/trending")
def api_trending_videos():
    """Trending videos (sorted by views)."""
    videos = get_trending_feed()
    return {"count": len(videos), "videos": videos}

# ---------------- SINGLE VIDEO ----------------

@app.get("/api/videos/{video_id}")
def api_get_video(video_id: str):
    video = get_video(video_id)
    if not video:
        raise HTTPException(404, "Video not found")

    # Merge with stats before returning
    try:
        stats = get_video_stats(video_id)
        social_stats = social.get_video_social(
            video_id,
            owner_id=video.get("creator_id"),
            owner_name=video.get("channel") or video.get("creator_name"),
        )
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    video["views"] = stats.get("views", 0)
    video["likes"] = social_stats["likes"]
    video["dislikes"] = social_stats["dislikes"]

    return video


@app.post("/api/videos/{video_id}/view")
def api_add_view(video_id: str, payload: dict = Body(default={})):
    """Increment view count for a video."""
    video = get_video(video_id)
    if not video:
        raise HTTPException(404, "Video not found")

    try:
        new_stats = increment_view(video_id)
        social.record_view(payload.get("user_id"), video_id)
    except requests.RequestException as exc:
        raise HTTPException(502, "Could not save video view statistics") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(502 if isinstance(exc, RuntimeError) else 400, str(exc)) from exc
    return {"success": True, "stats": new_stats}


@app.get("/api/videos/{video_id}/social")
def api_get_video_social(video_id: str, user_id: str = None):
    video = get_video(video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    try:
        return social.get_video_social(
            video_id,
            user_id,
            owner_id=video.get("creator_id"),
            owner_name=video.get("channel") or video.get("creator_name"),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/videos/{video_id}/reaction")
def api_set_video_reaction(video_id: str, payload: dict = Body(...)):
    video = get_video(video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    try:
        user_id = social.validate_user_id(payload.get("user_id"))
        user = social.get_user(user_id) or {}
        if not user:
            raise ValueError("Sync your PIXLECT profile before reacting")
        if video.get("creator_id"):
            social.register_video_owner(
                video_id,
                video["creator_id"],
                video.get("channel") or video.get("creator_name") or "Creator",
            )
        return social.set_reaction(
            user_id,
            user.get("username", "PIXLECT user"),
            video_id,
            payload.get("reaction"),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/videos/{video_id}/comments")
def api_add_video_comment(video_id: str, payload: dict = Body(...)):
    video = get_video(video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    try:
        user_id = social.validate_user_id(payload.get("user_id"))
        user = social.get_user(user_id) or {}
        if not user:
            raise ValueError("Sync your PIXLECT profile before commenting")
        if video.get("creator_id"):
            social.register_video_owner(
                video_id,
                video["creator_id"],
                video.get("channel") or video.get("creator_name") or "Creator",
            )
        return social.add_comment(
            user_id,
            user.get("username", "PIXLECT user"),
            video_id,
            payload.get("text"),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/videos/{video_id}/subscriptions")
def api_toggle_subscription(video_id: str, payload: dict = Body(...)):
    video = get_video(video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    creator_id = video.get("creator_id")
    if not creator_id:
        raise HTTPException(400, "This video has no PIXLECT creator ID")
    try:
        user_id = social.validate_user_id(payload.get("user_id"))
        user = social.get_user(user_id) or {}
        if not user:
            raise ValueError("Sync your PIXLECT profile before subscribing")
        social.register_video_owner(
            video_id,
            creator_id,
            video.get("channel") or video.get("creator_name") or "Creator",
        )
        return social.toggle_subscription(
            user_id,
            user.get("username", "PIXLECT user"),
            creator_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/users/sync")
def api_sync_user(payload: dict = Body(...)):
    try:
        user = social.upsert_user(
            payload.get("user_id"),
            payload.get("username"),
            payload.get("channel", ""),
            payload.get("icon"),
        )
        return {"success": True, "user": user}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.get("/api/users/{user_id}/activity")
def api_get_user_activity(user_id: str):
    try:
        return social.get_user_activity(user_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/users/{user_id}/notifications/read")
def api_mark_notifications_read(user_id: str):
    try:
        social.mark_notifications_read(user_id)
        return {"success": True}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc

# ---------------- UPLOAD ----------------

@app.post("/api/upload")
async def api_upload(
    file: UploadFile = File(...),
    title: str = Form("Untitled"),
    description: str = Form(""),
    category: str = Form("General"),
    visibility: str = Form("Public"),
    channel: str = Form(...),
    creator_name: str = Form(""),
    video_type: str = Form("video"),
    creator_id: str = Form(""),
):
    if not file.filename:
        raise HTTPException(400, "No file provided")
    channel = channel.strip()
    creator_name = creator_name.strip()
    if not channel:
        raise HTTPException(400, "Set a channel name in Settings before uploading")
    if len(channel) > 50:
        raise HTTPException(400, "Channel name must be 50 characters or fewer")
    if len(creator_name) > 50:
        raise HTTPException(400, "Display name must be 50 characters or fewer")
    if video_type == "short":
        video_type = "mini"
    elif video_type == "video":
        video_type = "long"
    if video_type not in ("long", "mini"):
        raise HTTPException(400, "Video type must be 'long' or 'mini'")
    if creator_id:
        try:
            creator_id = social.validate_user_id(creator_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    ext = os.path.splitext(file.filename)[1].lower() or ".mp4"
    video_id = uuid.uuid4().hex
    remote_path = f"videos/{video_id}{ext}"

    tmp_path = None
    try:
        # 1. Save to temp file (explicitly under TMPDIR — /tmp on Vercel)
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=ext, dir=TMP_DIR
        ) as tmp:
            tmp_path = tmp.name
            while chunk := await file.read(1024 * 1024):  # 1 MiB chunks
                tmp.write(chunk)

        # 2. Upload to Bunny Storage
        result = upload_video(
            tmp_path,
            remote_path,
            content_type=file.content_type or "video/mp4",
        )

        if not result["success"]:
            raise HTTPException(502, f"Bunny upload failed: {result['message']}")

        # 3. Create metadata object
        meta = {
            "id": video_id,
            "title": title,
            "description": description,
            "category": category,
            "visibility": visibility,
            "channel": channel,
            "creator_name": creator_name,
            "creator_id": creator_id or None,
            "video_type": video_type,
            "url": result["url"],
            "remote_path": remote_path,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "status": "Active",
        }

        # 4. Update master index in Bunny
        videos = load_all_videos()
        videos.append(meta)
        if not save_video_index(videos):
            raise HTTPException(502, "Video uploaded but its index could not be saved")

        if creator_id:
            try:
                social.register_video_owner(
                    video_id,
                    creator_id,
                    channel or creator_name,
                )
            except (RuntimeError, ValueError) as exc:
                raise HTTPException(
                    502,
                    "Video uploaded, but its creator profile could not be saved to Bunny Storage",
                ) from exc

        return JSONResponse(meta, status_code=201)

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

# ---------------- DELETE ----------------

@app.delete("/api/videos/{video_id}")
def api_delete_video(video_id: str):
    videos = load_all_videos()
    target = next((v for v in videos if v["id"] == video_id), None)

    if not target:
        raise HTTPException(404, "Video not found")

    # 1. Delete binary file from Bunny
    result = delete_video(target["remote_path"])
    if not result["success"]:
        raise HTTPException(502, f"Bunny delete failed: {result['message']}")

    # 2. Remove from index and save
    videos = [v for v in videos if v["id"] != video_id]
    if not save_video_index(videos):
        raise HTTPException(502, "Video was deleted but the video index could not be saved")

    return {"success": True, "id": video_id}

# ---------------- ADMIN STATS ----------------

@app.get("/api/admin/stats")
def api_admin_stats():
    """Return metrics for the admin dashboard."""
    return get_platform_stats()

# ------------------------------------------------------------------
# Static files — mounted LAST so /api/* takes priority.
# On Vercel, static assets should normally live under /public and be
# served by the platform. We only mount here if ./static exists
# (local dev), and never raise if it's missing.
# ------------------------------------------------------------------
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
else:
    print(f"[warn] static/ not found at {STATIC_DIR}; serving API only")

# ------------------------------------------------------------------
# Entry point (local dev only — Vercel imports `app` directly)
# ------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    print("=" * 60)
    print(" PIXELTube dev server")
    print(f"   UI      : http://localhost:{PORT}/")
    print(f"   Admin   : http://localhost:{PORT}/admin.html")
    print(f"   Studio  : http://localhost:{PORT}/studio.html")
    print(f"   API     : http://localhost:{PORT}/api/health")
    print(f"   Docs    : http://localhost:{PORT}/docs")
    print(f"   TMP_DIR : {TMP_DIR}")
    print("=" * 60)

    if not os.getenv("BUNNY_ACCESS_KEY") or "PASTE-YOUR" in os.getenv("BUNNY_ACCESS_KEY", "PASTE-YOUR"):
        print("⚠️  BUNNY_ACCESS_KEY not set (or still placeholder).")
        print("   Uploads will fail. Check storage.py config.")
        print("=" * 60)

    uvicorn.run(app, host=HOST, port=PORT, reload=False, log_level="info")
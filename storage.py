"""
storage.py — Bunny Storage (UK) direct upload for PIXELTube.
Loads configuration from ./storage.env.
"""

import json
import os
import requests
from typing import Optional

# Try to load from storage.env
try:
    from dotenv import load_dotenv
    # Loads ./storage.env if it exists
    load_dotenv("storage.env") 
except ImportError:
    print("⚠️  python-dotenv not installed. Falling back to system environment variables.")
    print("   Run: pip install python-dotenv")

# --- Config (Reads from environment / storage.env) ---
BUNNY_STORAGE_ZONE = os.getenv("BUNNY_STORAGE_ZONE", "pixeltube-videos")
BUNNY_ACCESS_KEY   = os.getenv("BUNNY_ACCESS_KEY", "")
BUNNY_REGION       = os.getenv("BUNNY_REGION", "uk")

# Public CDN base for serving (attach a Pull Zone in the Bunny dashboard)
CDN_BASE = os.getenv("BUNNY_CDN_BASE", "")

STORAGE_BASE = f"https://{BUNNY_REGION}.storage.bunnycdn.com"


def upload_video(local_file_path: str,
                 remote_path: str,
                 content_type: Optional[str] = "video/mp4") -> dict:
    """Stream a local video file directly to Bunny Storage."""
    if not BUNNY_ACCESS_KEY:
        return {"success": False, "status": 0,
                "message": "BUNNY_ACCESS_KEY is missing. Check storage.env", "url": ""}

    if not os.path.isfile(local_file_path):
        return {"success": False, "status": 0,
                "message": f"File not found: {local_file_path}", "url": ""}

    remote_path = remote_path.lstrip("/")
    upload_url = f"{STORAGE_BASE}/{BUNNY_STORAGE_ZONE}/{remote_path}"

    headers = {
        "AccessKey": BUNNY_ACCESS_KEY,
        "Content-Type": content_type,
    }

    try:
        with open(local_file_path, "rb") as f:
            r = requests.put(upload_url, headers=headers, data=f,
                             timeout=(10, 600))

        if r.status_code == 201:
            public_url = f"{CDN_BASE.rstrip('/')}/{remote_path}" if CDN_BASE else f"/{remote_path}"
            return {"success": True, "status": 201,
                    "message": "Upload successful", "url": public_url}

        return {"success": False, "status": r.status_code,
                "message": r.text or "Upload failed", "url": ""}

    except requests.exceptions.Timeout:
        return {"success": False, "status": 0,
                "message": "Upload timed out", "url": ""}
    except requests.exceptions.RequestException as e:
        return {"success": False, "status": 0,
                "message": f"Request error: {e}", "url": ""}


def delete_video(remote_path: str) -> dict:
    """Delete a file from Bunny Storage."""
    if not BUNNY_ACCESS_KEY:
        return {"success": False, "status": 0, "message": "Missing BUNNY_ACCESS_KEY"}

    remote_path = remote_path.lstrip("/")
    url = f"{STORAGE_BASE}/{BUNNY_STORAGE_ZONE}/{remote_path}"
    
    try:
        r = requests.delete(url, headers={"AccessKey": BUNNY_ACCESS_KEY}, timeout=30)
        return {"success": r.status_code == 200,
                "status": r.status_code,
                "message": r.text or "Deleted"}
    except requests.exceptions.RequestException as e:
        return {"success": False, "status": 0, "message": str(e)}


def get_file_json(remote_path: str) -> dict | list | None:
    """Fetch a JSON file directly from Bunny Storage."""
    if not BUNNY_ACCESS_KEY:
        raise RuntimeError("BUNNY_ACCESS_KEY is missing. Check storage.env")
        
    remote_path = remote_path.lstrip("/")
    url = f"{STORAGE_BASE}/{BUNNY_STORAGE_ZONE}/{remote_path}"
    
    try:
        r = requests.get(url, headers={"AccessKey": BUNNY_ACCESS_KEY}, timeout=10)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        try:
            return r.json()
        except ValueError as exc:
            raise RuntimeError(f"Bunny file {remote_path} does not contain valid JSON") from exc
    except requests.exceptions.RequestException as exc:
        raise RuntimeError(f"Could not read {remote_path} from Bunny Storage: {exc}") from exc


def save_file_json(remote_path: str, data: dict | list) -> bool:
    """Save a JSON file directly to Bunny Storage."""
    if not BUNNY_ACCESS_KEY:
        raise RuntimeError("BUNNY_ACCESS_KEY is missing. Check storage.env")
        
    remote_path = remote_path.lstrip("/")
    url = f"{STORAGE_BASE}/{BUNNY_STORAGE_ZONE}/{remote_path}"
    
    try:
        r = requests.put(
            url,
            headers={"AccessKey": BUNNY_ACCESS_KEY, "Content-Type": "application/json"},
            data=json.dumps(data, indent=2).encode('utf-8'),
            timeout=15
        )
        return r.status_code in (200, 201)
    except requests.exceptions.RequestException as exc:
        raise RuntimeError(f"Could not save {remote_path} to Bunny Storage: {exc}") from exc


def list_files(remote_dir: str = "") -> list:
    """List files in a Bunny Storage folder."""
    if not BUNNY_ACCESS_KEY:
        return []
        
    remote_dir = remote_dir.strip("/")
    url = f"{STORAGE_BASE}/{BUNNY_STORAGE_ZONE}/{remote_dir}/"
    try:
        r = requests.get(url, headers={"AccessKey": BUNNY_ACCESS_KEY}, timeout=30)
        return r.json() if r.status_code == 200 else []
    except requests.exceptions.RequestException:
        return []


def file_exists(remote_path: str) -> bool:
    """Check whether a file exists in Bunny Storage."""
    if not BUNNY_ACCESS_KEY:
        return False
        
    remote_path = remote_path.lstrip("/")
    url = f"{STORAGE_BASE}/{BUNNY_STORAGE_ZONE}/{remote_path}"
    try:
        # Use GET with Range instead of HEAD to avoid Bunny/CDN edge-case blocks.
        # Range bytes=0-0 requests only 1 byte of the file, which is incredibly fast.
        r = requests.get(
            url, 
            headers={"AccessKey": BUNNY_ACCESS_KEY, "Range": "bytes=0-0"}, 
            timeout=15
        )
        return r.status_code in (200, 206)
    except requests.exceptions.RequestException:
        return False
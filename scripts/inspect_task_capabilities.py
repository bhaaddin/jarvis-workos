"""Presence/runtime audit for the practical task pack; never print credentials."""
from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from project_hub.gateway import Gateway
from project_hub.projects import Projects

result = {"checked_at": datetime.now(timezone.utc).isoformat(), "executables": {}, "python_packages": {}, "services": {}}
for name in ("node", "git", "docker", "gh", "powershell", "tesseract", "uv"):
    result["executables"][name] = bool(shutil.which(name))
for name in ("pypdf", "openpyxl", "python-docx", "reportlab", "playwright"):
    try:
        result["python_packages"][name] = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        result["python_packages"][name] = None
for name, url in {"project_hub": "http://127.0.0.1:18791/health", "operator": "http://127.0.0.1:18801/health",
                  "speech_gpu": "http://127.0.0.1:18902/health", "clinic_api": "http://127.0.0.1:5092/health"}.items():
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            result["services"][name] = {"http_status": response.status}
    except Exception as error:
        result["services"][name] = {"http_status": getattr(error, "code", None), "error": type(error).__name__}
gateway = Gateway()
try:
    skills = gateway.skills(refresh=True)
    result["installed_skills"] = [{key: item.get(key) for key in ("name", "ready", "missing", "modelVisible")} for item in skills]
except Exception as error:
    result["inventory_error"] = type(error).__name__
database = ROOT / "runtime/project-hub.sqlite"
if database.is_file():
    result["connected_projects"] = [{"id": item["id"], "name": item["name"], "roots": [root["id"] for root in item["roots"]]}
                                    for item in Projects(database).list()]
if shutil.which("gh"):
    account = subprocess.run(["gh", "api", "user", "--jq", ".login"], capture_output=True, timeout=20, check=False)
    result["github_cli_authenticated"] = account.returncode == 0
folder = ROOT / "logs" / ("task-capability-audit-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
folder.mkdir()
(folder / "results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
print("Artifacts:", folder)

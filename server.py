import json
import os
import shutil
import tempfile
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


SITE_DIR = os.environ.get("SITE_DIR", "/app/site")
MAP_PATH = os.environ.get("MAP_PATH", "/data/ros/map.json")
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8090"))


class MapEditorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SITE_DIR, **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/status":
            return self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "map_path": MAP_PATH,
                    "map_exists": os.path.exists(MAP_PATH),
                },
            )
        if path == "/map.json":
            return self._send_map()
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/save":
            return self._send_json(
                HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"}
            )

        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception as exc:
            return self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": f"Invalid JSON: {exc}"},
            )

        if not isinstance(payload, dict) or not isinstance(payload.get("areas"), list):
            return self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "Map JSON must contain an areas array."},
            )

        backup_path = None
        os.makedirs(os.path.dirname(MAP_PATH), exist_ok=True)

        if os.path.exists(MAP_PATH):
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            backup_path = f"{MAP_PATH}.bak.{timestamp}"
            shutil.copy2(MAP_PATH, backup_path)

        temp_fd, temp_path = tempfile.mkstemp(
            prefix="map-", suffix=".json", dir=os.path.dirname(MAP_PATH)
        )
        try:
            with os.fdopen(temp_fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2)
                handle.write("\n")
            os.replace(temp_path, MAP_PATH)
        except Exception:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise

        return self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "message": "Map saved.",
                "backup_path": backup_path,
            },
        )

    def _send_map(self):
        if not os.path.exists(MAP_PATH):
            return self._send_json(
                HTTPStatus.NOT_FOUND,
                {"ok": False, "error": f"Map file not found: {MAP_PATH}"},
            )
        with open(MAP_PATH, "rb") as handle:
            payload = handle.read()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _send_json(self, status, payload):
        content = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    httpd = ThreadingHTTPServer((HOST, PORT), MapEditorHandler)
    print(f"Serving OpenMower Map Editor on http://{HOST}:{PORT}")
    httpd.serve_forever()

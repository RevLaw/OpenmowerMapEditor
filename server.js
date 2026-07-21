const express = require("express");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const yaml = require("js-yaml");

const app = express();
const port = process.env.PORT || 80;

// Defaults match the in-container mount points; overridable for local dev
// (e.g. PARAMS_PATH=./params/mower_params.yaml MAP_PATH=./ros/map.json).
const paramsPath = process.env.PARAMS_PATH || "/data/params/mower_params.yaml";
const mapPath = process.env.MAP_PATH || "/data/ros/map.json";
const mapDirectory = path.dirname(mapPath);
const wifiMapPath = process.env.WIFI_MAP_PATH || path.join(mapDirectory, "wifi-signal-map.json");
const wifiCellSizeM = Math.max(
  0.25,
  Math.min(5, Number(process.env.WIFI_MAP_CELL_SIZE_M) || 0.75)
);
const wifiMaxPoints = Math.max(
  100,
  Math.min(10000, Math.floor(Number(process.env.WIFI_MAP_MAX_POINTS) || 2000))
);
const wifiFlushMs = Math.max(
  10000,
  Math.min(300000, Math.floor(Number(process.env.WIFI_MAP_FLUSH_MS) || 30000))
);
const wifiCollectorIntervalMs = Math.max(
  5000,
  Math.min(300000, Math.floor(Number(process.env.WIFI_MAP_COLLECTOR_INTERVAL_MS) || 10000))
);
const wifiCollectorTfTimeoutSec = Math.max(
  1,
  Math.min(5, Math.floor(Number(process.env.WIFI_MAP_COLLECTOR_TF_TIMEOUT_SEC) || 2))
);
const wifiCollectorCellRevisitMs = Math.max(
  60000,
  Math.min(
    3600000,
    Math.floor(Number(process.env.WIFI_MAP_COLLECTOR_CELL_REVISIT_MS) || 300000)
  )
);
const wifiCollectorDisabled =
  String(process.env.WIFI_MAP_COLLECTOR_DISABLE || "").trim() === "1";
const distDir = path.join(__dirname, "dist");
const dockerSocketPath = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
const restartContainerName = process.env.OPENMOWER_CONTAINER_NAME || "open_mower_ros";
const poseContainerName = process.env.OPENMOWER_POSE_CONTAINER || restartContainerName;
/** Keep ≥ client poll interval so one slow Docker exec can satisfy several polls (avoids ~15s gaps). */
const poseCacheMs = Math.max(200, Number(process.env.OPENMOWER_POSE_CACHE_MS) || 2200);
const poseDisabled = String(process.env.OPENMOWER_POSE_DISABLE || "").trim() === "1";
/** Cap per-attempt TF echo wait (fail fast between frame pairs). */
const tfEchoTimeoutSec = Math.max(
  2,
  Math.min(60, Math.floor(Number(process.env.OPENMOWER_TF_ECHO_TIMEOUT_SEC) || 4))
);
/** Per-topic `ros2 topic echo -n 1` / `rostopic echo` wait (ROS1 on Pi often needs several seconds). */
const rosTopicSampleTimeoutSec = Math.max(
  2,
  Math.min(15, Math.floor(Number(process.env.OPENMOWER_ROS_TOPIC_TIMEOUT_SEC) || 4))
);
/** If fast topic loop yields nothing, one longer `rostopic echo` on current_state only (ROS1). */
const rosTopicFallbackTimeoutSec = Math.max(
  rosTopicSampleTimeoutSec,
  Math.min(25, Math.floor(Number(process.env.OPENMOWER_ROS_TOPIC_FALLBACK_SEC) || 10))
);
/** Per-request HTTP + Docker API + routine file reads (default off to keep logs readable). */
const verboseLogs = String(process.env.OPENMOWER_VERBOSE_LOGS || "").trim() === "1";

function nowIso() {
  return new Date().toISOString();
}

function logInfo(message, meta = {}) {
  console.log(`[${nowIso()}] [INFO] ${message}`, meta);
}

function logWarn(message, meta = {}) {
  console.warn(`[${nowIso()}] [WARN] ${message}`, meta);
}

function logError(message, meta = {}) {
  console.error(`[${nowIso()}] [ERROR] ${message}`, meta);
}

const wifiSurvey = new Map();
let wifiSurveyLoaded = false;
let wifiSurveyLoadPromise = null;
let wifiSurveyDirty = false;
let wifiSurveyFlushTimer = null;
let wifiSurveyFlushPromise = null;
let wifiSurveyRevision = 0;
let wifiSurveyUpdatedAt = null;
let wifiSurveyLastBytes = 0;
let wifiCollectorTimer = null;
let wifiCollectorInFlight = false;
let wifiCollectorStopped = false;
let wifiCollectorSuccessCount = 0;
let wifiCollectorFailureCount = 0;
let wifiCollectorStoredCount = 0;
let wifiCollectorLastCollectedAt = null;
let wifiCollectorLastStoredAt = null;
let wifiCollectorLastSignalDbm = null;
let wifiCollectorLastInterface = null;
let wifiCollectorLastDurationMs = null;
let wifiCollectorLastError = null;

function wifiCellKey(x, y) {
  return `${Math.round(x / wifiCellSizeM)},${Math.round(y / wifiCellSizeM)}`;
}

function normalizeWifiSample(sample) {
  const x = Number(sample?.x);
  const y = Number(sample?.y);
  const signalDbm = Number(sample?.signalDbm);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(signalDbm) ||
    Math.abs(x) > 100000 ||
    Math.abs(y) > 100000 ||
    signalDbm < -120 ||
    signalDbm > 0
  ) {
    return null;
  }
  const key = wifiCellKey(x, y);
  const [cellX, cellY] = key.split(",").map(Number);
  return {
    key,
    x: Number((cellX * wifiCellSizeM).toFixed(3)),
    y: Number((cellY * wifiCellSizeM).toFixed(3)),
    signalDbm,
    timestamp: Date.now(),
  };
}

function evictOldestWifiSample() {
  let oldestKey = null;
  let oldestTimestamp = Infinity;
  for (const [key, sample] of wifiSurvey) {
    if (sample.timestamp < oldestTimestamp) {
      oldestKey = key;
      oldestTimestamp = sample.timestamp;
    }
  }
  if (oldestKey != null) wifiSurvey.delete(oldestKey);
}

function mergeWifiSurveySample(input, markDirty = true) {
  const sample = normalizeWifiSample(input);
  if (!sample) return false;
  const previous = wifiSurvey.get(sample.key);
  if (previous) {
    const weight = Math.min(Math.max(previous.samples || 1, 1), 9);
    previous.signalDbm = Number(
      ((previous.signalDbm * weight + sample.signalDbm) / (weight + 1)).toFixed(1)
    );
    previous.samples = Math.min((previous.samples || 1) + 1, 1000000);
    previous.timestamp = sample.timestamp;
  } else {
    if (wifiSurvey.size >= wifiMaxPoints) evictOldestWifiSample();
    wifiSurvey.set(sample.key, {
      x: sample.x,
      y: sample.y,
      signalDbm: Number(sample.signalDbm.toFixed(1)),
      samples: 1,
      timestamp: sample.timestamp,
    });
  }
  if (markDirty) {
    wifiSurveyDirty = true;
    wifiSurveyRevision += 1;
    wifiSurveyUpdatedAt = Date.now();
    scheduleWifiSurveyFlush();
  }
  return true;
}

async function ensureWifiSurveyLoaded() {
  if (wifiSurveyLoaded) return;
  if (wifiSurveyLoadPromise) return wifiSurveyLoadPromise;
  wifiSurveyLoadPromise = (async () => {
    try {
      const content = await fs.readFile(wifiMapPath, "utf8");
      wifiSurveyLastBytes = Buffer.byteLength(content, "utf8");
      const parsed = JSON.parse(content);
      const samples = Array.isArray(parsed?.samples) ? parsed.samples.slice(-wifiMaxPoints) : [];
      for (const sample of samples) {
        const normalized = normalizeWifiSample(sample);
        if (!normalized) continue;
        const timestamp = Number(sample.timestamp);
        const sampleCount = Number(sample.samples);
        wifiSurvey.set(normalized.key, {
          x: normalized.x,
          y: normalized.y,
          signalDbm: Number(normalized.signalDbm.toFixed(1)),
          samples: Number.isFinite(sampleCount)
            ? Math.max(1, Math.min(1000000, Math.floor(sampleCount)))
            : 1,
          timestamp: Number.isFinite(timestamp) ? timestamp : normalized.timestamp,
        });
      }
      wifiSurveyUpdatedAt = Number(parsed?.updatedAt) || null;
      wifiSurveyRevision = 1;
      logInfo("Loaded central WiFi survey", {
        file: wifiMapPath,
        points: wifiSurvey.size,
        bytes: wifiSurveyLastBytes,
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        logWarn("Failed to load central WiFi survey; starting empty", {
          file: wifiMapPath,
          error: error.message,
        });
      }
    } finally {
      wifiSurveyLoaded = true;
      wifiSurveyLoadPromise = null;
    }
  })();
  return wifiSurveyLoadPromise;
}

function wifiSurveyPayload() {
  return {
    version: 1,
    cellSizeM: wifiCellSizeM,
    maxPoints: wifiMaxPoints,
    updatedAt: wifiSurveyUpdatedAt,
    samples: [...wifiSurvey.values()],
  };
}

async function applyMowerFileOwnership(filePath) {
  for (const ownerPath of [wifiMapPath, mapPath, mapDirectory]) {
    try {
      const owner = await fs.stat(ownerPath);
      await fs.chown(filePath, owner.uid, owner.gid);
      break;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "EPERM") throw error;
    }
  }
  await fs.chmod(filePath, 0o664);
}

async function flushWifiSurvey(forceAll = false) {
  if (wifiSurveyFlushTimer) {
    clearTimeout(wifiSurveyFlushTimer);
    wifiSurveyFlushTimer = null;
  }
  if (wifiSurveyFlushPromise) {
    await wifiSurveyFlushPromise;
    if (forceAll && wifiSurveyDirty) return flushWifiSurvey(true);
    return;
  }
  if (!wifiSurveyLoaded || !wifiSurveyDirty) return;
  const flushRevision = wifiSurveyRevision;
  wifiSurveyFlushPromise = (async () => {
    const payload = JSON.stringify(wifiSurveyPayload());
    const temporaryPath = `${wifiMapPath}.tmp`;
    await fs.mkdir(path.dirname(wifiMapPath), { recursive: true });
    await fs.writeFile(temporaryPath, payload, "utf8");
    await applyMowerFileOwnership(temporaryPath);
    await fs.rename(temporaryPath, wifiMapPath);
    wifiSurveyLastBytes = Buffer.byteLength(payload, "utf8");
    wifiSurveyDirty = wifiSurveyRevision !== flushRevision;
    logInfo("Flushed central WiFi survey", {
      file: wifiMapPath,
      points: wifiSurvey.size,
      bytes: wifiSurveyLastBytes,
    });
  })();
  try {
    await wifiSurveyFlushPromise;
  } finally {
    wifiSurveyFlushPromise = null;
  }
  if (wifiSurveyDirty) {
    if (forceAll) return flushWifiSurvey(true);
    scheduleWifiSurveyFlush();
  }
}

function scheduleWifiSurveyFlush() {
  if (wifiSurveyFlushTimer) return;
  wifiSurveyFlushTimer = setTimeout(() => {
    flushWifiSurvey().catch((error) => {
      logError("Failed to flush central WiFi survey", {
        file: wifiMapPath,
        error: error.message,
      });
      if (wifiSurveyDirty) scheduleWifiSurveyFlush();
    });
  }, wifiFlushMs);
  wifiSurveyFlushTimer.unref?.();
}

function wifiSurveyMeta() {
  return {
    revision: wifiSurveyRevision,
    sampleCount: wifiSurvey.size,
    updatedAt: wifiSurveyUpdatedAt,
    storage: {
      central: true,
      cellSizeM: wifiCellSizeM,
      maxPoints: wifiMaxPoints,
      flushIntervalMs: wifiFlushMs,
      fileBytes: wifiSurveyLastBytes,
      collector: {
        enabled: !wifiCollectorDisabled && !poseDisabled,
        intervalMs: wifiCollectorIntervalMs,
        tfTimeoutSec: wifiCollectorTfTimeoutSec,
        cellRevisitMs: wifiCollectorCellRevisitMs,
        inFlight: wifiCollectorInFlight,
        successCount: wifiCollectorSuccessCount,
        failureCount: wifiCollectorFailureCount,
        storedCount: wifiCollectorStoredCount,
        lastCollectedAt: wifiCollectorLastCollectedAt,
        lastStoredAt: wifiCollectorLastStoredAt,
        lastSignalDbm: wifiCollectorLastSignalDbm,
        lastInterface: wifiCollectorLastInterface,
        lastDurationMs: wifiCollectorLastDurationMs,
        lastError: wifiCollectorLastError,
      },
    },
  };
}

app.use(express.json({ limit: "20mb" }));
app.use(express.static(distDir));
app.use((req, res, next) => {
  if (!verboseLogs) {
    next();
    return;
  }
  const startedAt = Date.now();
  res.on("finish", () => {
    logInfo("HTTP request finished", {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
});

function shouldRestartFromQuery(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function extractGpsDatum(data) {
  const datumLat = data?.ll?.services?.gps?.datum_lat;
  const datumLng = data?.ll?.services?.gps?.datum_long;
  if (!Number.isFinite(datumLat) || !Number.isFinite(datumLng)) {
    return null;
  }
  return { datumLat, datumLng };
}

function isValidMapFileName(fileName) {
  return (
    typeof fileName === "string" &&
    (fileName === "map.json" || fileName.startsWith("map.json.bak-")) &&
    fileName === path.basename(fileName)
  );
}

function dockerApiRequest(method, requestPath, requestBody = null, options = {}) {
  const binaryBody = Boolean(options.binaryBody);
  return new Promise((resolve, reject) => {
    const payload =
      requestBody == null ? null : Buffer.from(JSON.stringify(requestBody), "utf8");
    const headers = {};
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(payload.length);
    }
    if (verboseLogs) {
      logInfo("Docker API request", {
        method,
        requestPath,
        hasBody: Boolean(payload),
        binaryBody,
      });
    }
    const req = http.request(
      {
        socketPath: dockerSocketPath,
        path: requestPath,
        method,
        headers,
      },
      (res) => {
        if (binaryBody) {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks) });
          });
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode || 0, body });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Reads tf_echo / tf2_echo stdout on stdin; prints "x y yaw" for bash wrapper. No ROS Python deps. */
const ROBOT_TF_PARSE_PY = `import math
import re
import sys

text = sys.stdin.read()
mt = re.search(r"Translation:\\s*\\[\\s*([-+\\d.eE]+)\\s*,\\s*([-+\\d.eE]+)", text)
if not mt:
    sys.exit(1)
x, y = float(mt.group(1)), float(mt.group(2))
mq = re.search(
    r"Quaternion[^\\[]*\\[\\s*([-+\\d.eE]+)\\s*,\\s*([-+\\d.eE]+)\\s*,\\s*([-+\\d.eE]+)\\s*,\\s*([-+\\d.eE]+)\\s*\\]",
    text,
)
yaw = 0.0
if mq:
    qx, qy, qz, qw = map(float, mq.groups())
    siny_cosp = 2 * (qw * qz + qx * qy)
    cosy_cosp = 1 - 2 * (qy * qy + qz * qz)
    yaw = math.atan2(siny_cosp, cosy_cosp)
print("{:.6f} {:.6f} {:.6f}".format(x, y, yaw))
`;

function buildRobotPoseProbeBash() {
  const b64 = Buffer.from(ROBOT_TF_PARSE_PY, "utf8").toString("base64");
  return [
    "set +e",
    `echo '${b64}' | base64 -d > /tmp/om_parse_tf.py`,
    "for SETUP in /opt/ros/humble/setup.bash /opt/ros/jazzy/setup.bash /opt/ros/iron/setup.bash /opt/ros/noetic/setup.bash; do",
    '  [ -f "$SETUP" ] || continue',
    '  # shellcheck disable=SC1090',
    '  . "$SETUP"',
    "  break",
    "done",
    "for WS in /opt/open_mower_ros/devel/setup.bash /ros_ws/install/setup.bash /workspace/install/setup.bash /colcon_ws/install/setup.bash /catkin_ws/devel/setup.bash /open_mower/install/setup.bash; do",
    '  [ -f "$WS" ] || continue',
    '  # shellcheck disable=SC1090',
    '  . "$WS"',
    "  break",
    "done",
    "if command -v ros2 >/dev/null 2>&1; then",
    `  run_tf() { timeout ${tfEchoTimeoutSec} ros2 run tf2_ros tf2_echo "$1" "$2" 2>/dev/null; }`,
    "elif command -v rosrun >/dev/null 2>&1; then",
    `  run_tf() { timeout ${tfEchoTimeoutSec} rosrun tf tf_echo "$1" "$2" 2>/dev/null; }`,
    "else",
    '  echo "ERR no ros2 or rosrun in PATH after sourcing /opt/ros"',
    "  exit 1",
    "fi",
    "sample_extra() {",
    "  local out t",
    "  t=$1",
    `  out=$(timeout ${rosTopicSampleTimeoutSec} ros2 topic echo -n 1 "$t" 2>/dev/null | head -n 48)`,
    '  [ -z "$out" ] && return 1',
    '  case "$t" in *emergency*)',
    '    echo "$out" | grep -qi "active_emergency: false" && echo "$out" | grep -qi "latched_emergency: false" && return 1',
    "    ;;",
    "  esac",
    "  echo EXTRA_BEGIN",
    '  echo "topic:$t"',
    '  echo "$out"',
    "  echo EXTRA_END",
    "  return 0",
    "}",
    "sample_extra_ros1() {",
    "  local out t",
    "  t=$1",
    `  out=$(timeout ${rosTopicSampleTimeoutSec} rostopic echo -n 1 "$t" 2>/dev/null | head -n 48)`,
    '  [ -z "$out" ] && return 1',
    '  case "$t" in *emergency*)',
    '    echo "$out" | grep -qi "active_emergency: false" && echo "$out" | grep -qi "latched_emergency: false" && return 1',
    "    ;;",
    "  esac",
    "  echo EXTRA_BEGIN",
    '  echo "topic:${t#/}"',
    '  echo "$out"',
    "  echo EXTRA_END",
    "  return 0",
    "}",
    'for parent in map odom; do',
    '  for child in base_link base_footprint; do',
    "    parsed=$(run_tf \"$parent\" \"$child\" | head -n 45 | python3 /tmp/om_parse_tf.py) || continue",
    '    echo "OK $parsed $parent $child"',
    "    ros_extra_sampled=0",
    "    if command -v rostopic >/dev/null 2>&1; then",
    '      for t in /mower_logic/current_state /ll/emergency /ll/mower_status; do',
    "        if sample_extra_ros1 \"$t\"; then ros_extra_sampled=1; break; fi",
    "      done",
    "    fi",
    "    if [ \"$ros_extra_sampled\" != 1 ] && command -v rostopic >/dev/null 2>&1; then",
    `      out=$(timeout ${rosTopicFallbackTimeoutSec} rostopic echo -n 1 /mower_logic/current_state 2>/dev/null | head -n 48)`,
    '      if [ -n "$out" ]; then',
    "        echo EXTRA_BEGIN",
    '        echo "topic:mower_logic/current_state"',
    '        echo "$out"',
    "        echo EXTRA_END",
    "        ros_extra_sampled=1",
    "      fi",
    "    fi",
    "    if [ \"$ros_extra_sampled\" != 1 ] && command -v ros2 >/dev/null 2>&1; then",
    '      for tt in mower_logic/current_state ll/emergency ll/mower_status; do',
    '        t="${tt#/}"',
    "        if sample_extra \"$t\"; then break; fi",
    "      done",
    "    fi",
    "    echo WIFI_BEGIN",
    "    cat /proc/net/wireless 2>/dev/null",
    "    echo WIFI_END",
    "    exit 0",
    "  done",
    "done",
    'echo "ERR no TF transform (tried map/odom -> base_link/base_footprint)"',
    "exit 1",
  ].join("\n");
}

function buildWifiCollectorProbeBash() {
  const b64 = Buffer.from(ROBOT_TF_PARSE_PY, "utf8").toString("base64");
  return [
    "set +e",
    "for SETUP in /opt/ros/humble/setup.bash /opt/ros/jazzy/setup.bash /opt/ros/iron/setup.bash /opt/ros/noetic/setup.bash; do",
    '  [ -f "$SETUP" ] || continue',
    '  . "$SETUP"',
    "  break",
    "done",
    "for WS in /opt/open_mower_ros/devel/setup.bash /ros_ws/install/setup.bash /workspace/install/setup.bash /colcon_ws/install/setup.bash /catkin_ws/devel/setup.bash /open_mower/install/setup.bash; do",
    '  [ -f "$WS" ] || continue',
    '  . "$WS"',
    "  break",
    "done",
    "if command -v ros2 >/dev/null 2>&1; then",
    `  run_tf() { timeout ${wifiCollectorTfTimeoutSec} ros2 run tf2_ros tf2_echo map "$1" 2>/dev/null; }`,
    "elif command -v rosrun >/dev/null 2>&1; then",
    `  run_tf() { timeout ${wifiCollectorTfTimeoutSec} rosrun tf tf_echo map "$1" 2>/dev/null; }`,
    "else",
    '  echo "ERR no ros2 or rosrun in PATH after sourcing /opt/ros"',
    "  exit 1",
    "fi",
    "for child in base_link base_footprint; do",
    `  parsed=$(run_tf "$child" | head -n 20 | python3 <(echo '${b64}' | base64 -d)) || continue`,
    '  echo "OK $parsed map $child"',
    "  echo WIFI_BEGIN",
    "  cat /proc/net/wireless 2>/dev/null",
    "  echo WIFI_END",
    "  exit 0",
    "done",
    'echo "ERR no TF transform (tried map -> base_link/base_footprint)"',
    "exit 1",
  ].join("\n");
}

let robotPoseCache = {
  expiresAt: 0,
  payload: null,
};
let robotPosePromise = null;

/**
 * Persistent ROS1 subscriber for the *smooth* live overlay. Subscribes to
 * `/xbot_positioning/xb_pose` (~48 Hz fused GPS/odom pose, map frame) and
 * `/xbot_monitoring/robot_state` (telemetry), and prints throttled compact JSON
 * lines. Runs once inside open_mower_ros (streamed via a long-lived docker exec)
 * instead of a fresh tf_echo per poll — that per-poll exec is why the old
 * overlay only moved every few seconds. Falls back to nothing on ROS2/other
 * setups (no xbot_msgs) — the SSE endpoint then serves the tf_echo probe.
 */
const ROBOT_STREAM_PY = `import json, math
import rospy
from xbot_msgs.msg import AbsolutePose, RobotState

MIN_DT = 0.05
_last = [0.0]


def _yaw(q):
    return math.atan2(2.0 * (q.w * q.z + q.x * q.y), 1.0 - 2.0 * (q.y * q.y + q.z * q.z))


def on_pose(m):
    now = rospy.get_time()
    if now - _last[0] < MIN_DT:
        return
    _last[0] = now
    p = m.pose.pose.position
    yaw = _yaw(m.pose.pose.orientation)
    print(json.dumps({"t": "P", "x": round(p.x, 3), "y": round(p.y, 3),
                      "yaw": round(yaw, 4), "acc": round(float(m.position_accuracy), 3),
                      "flags": int(m.flags)}), flush=True)


def on_state(m):
    print(json.dumps({"t": "S",
                      "state": str(getattr(m, "current_state", "") or ""),
                      "sub": str(getattr(m, "current_sub_state", "") or ""),
                      "batt": float(getattr(m, "battery_percentage", 0.0) or 0.0),
                      "gps": float(getattr(m, "gps_percentage", 0.0) or 0.0),
                      "charging": bool(getattr(m, "is_charging", False)),
                      "emergency": bool(getattr(m, "emergency", False)),
                      "rain": bool(getattr(m, "rain_detected", False))}), flush=True)


rospy.init_node("om_editor_pose_stream", anonymous=True, disable_signals=True)
rospy.Subscriber("/xbot_positioning/xb_pose", AbsolutePose, on_pose, queue_size=1)
rospy.Subscriber("/xbot_monitoring/robot_state", RobotState, on_state, queue_size=1)
print(json.dumps({"t": "R"}), flush=True)
rospy.spin()
`;

/**
 * Emit a bash program that decodes an embedded python script to /tmp, sources
 * ROS 1 (+ the OpenMower workspace), and runs it. Shared by the pose-stream,
 * plan_path, and control execs — they differ only in tmp name and exec line.
 */
function buildRosPythonBash(scriptSrc, { tmpName, exec = "python3" }) {
  const b64 = Buffer.from(scriptSrc, "utf8").toString("base64");
  return [
    "set +e",
    `echo '${b64}' | base64 -d > /tmp/${tmpName}`,
    "for SETUP in /opt/ros/noetic/setup.bash /opt/ros/melodic/setup.bash; do",
    '  [ -f "$SETUP" ] || continue',
    '  . "$SETUP"',
    "  break",
    "done",
    "for WS in /opt/open_mower_ros/devel/setup.bash /root/*/devel/setup.bash /catkin_ws/devel/setup.bash /open_mower/devel/setup.bash; do",
    '  [ -f "$WS" ] || continue',
    '  . "$WS"',
    "  break",
    "done",
    `exec ${exec} /tmp/${tmpName}`,
  ].join("\n");
}

function buildRobotStreamBash() {
  return buildRosPythonBash(ROBOT_STREAM_PY, { tmpName: "om_pose_stream.py", exec: "python3 -u" });
}

/** How long a streamed pose sample is considered current before we fall back. */
const liveStreamFreshMs = Math.max(
  500,
  Number(process.env.OPENMOWER_STREAM_FRESH_MS) || 2000
);

/**
 * Calls OpenMower's real coverage planner (/slic3r_coverage_planner/plan_path) so
 * the editor can draw the LITERAL path the robot drives, not an approximation.
 * Request comes in as base64 JSON via $PLAN_REQ_B64; prints the ordered paths as
 * JSON. Read-only: planning never commands the robot to move.
 */
const PLAN_PATH_PY = `import base64, json, os
import rospy
from geometry_msgs.msg import Polygon, Point32
from slic3r_coverage_planner.srv import PlanPath, PlanPathRequest


def poly(points):
    p = Polygon()
    for xy in points:
        pt = Point32()
        pt.x = float(xy[0])
        pt.y = float(xy[1])
        pt.z = 0.0
        p.points.append(pt)
    return p


def main():
    raw = base64.b64decode(os.environ.get("PLAN_REQ_B64", "")).decode() or "{}"
    req = json.loads(raw)
    rospy.init_node("om_editor_plan_path", anonymous=True, disable_signals=True)
    rospy.wait_for_service("/slic3r_coverage_planner/plan_path", timeout=10.0)
    call = rospy.ServiceProxy("/slic3r_coverage_planner/plan_path", PlanPath)
    r = PlanPathRequest()
    r.fill_type = int(req.get("fill_type", 0))
    r.angle = float(req.get("angle", 0.0))
    r.distance = float(req.get("distance", 0.14))
    r.outer_offset = float(req.get("outer_offset", 0.0))
    r.outline_count = int(req.get("outline_count", 3))
    r.outline_overlap_count = int(req.get("outline_overlap_count", 0))
    r.skip_area_outline = bool(req.get("skip_area_outline", False))
    r.skip_obstacle_outlines = bool(req.get("skip_obstacle_outlines", False))
    r.skip_fill = bool(req.get("skip_fill", False))
    r.outline = poly(req.get("outline", []))
    r.holes = [poly(h) for h in req.get("holes", [])]
    resp = call(r)
    paths = []
    laps = 0
    fill = 0
    npts = 0
    for pth in resp.paths:
        pts = [[round(ps.pose.position.x, 2), round(ps.pose.position.y, 2)] for ps in pth.path.poses]
        npts += len(pts)
        if int(pth.is_outline):
            laps += 1
        else:
            fill += 1
        paths.append({"is_outline": bool(int(pth.is_outline)), "pts": pts})
    print(json.dumps({"ok": True, "paths": paths, "stats": {"laps": laps, "fillRows": fill, "points": npts}}))


try:
    main()
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)[:300]}))
`;

function buildPlanPathBash() {
  return buildRosPythonBash(PLAN_PATH_PY, { tmpName: "om_plan_path.py", exec: "timeout 25 python3" });
}

const planPathCache = new Map(); // requestKey -> { expiresAt, payload }
const PLAN_PATH_CACHE_MS = 60000;

/**
 * Sends a whitelisted high-level command to the running mower. Start/Home/Reset
 * go through /mower_service/high_level_control; Stop is an immediate emergency
 * stop via /ll/_service/emergency. Command name comes in via $OM_CMD.
 *
 * SAFETY: these commands move a robot with spinning blades. Disable entirely
 * with OPENMOWER_CONTROL_DISABLE=1.
 */
const CONTROL_PY = `import json, os
import rospy
from mower_msgs.srv import (
    HighLevelControlSrv, HighLevelControlSrvRequest,
    EmergencyStopSrv, EmergencyStopSrvRequest,
)

HIGH_LEVEL = {"start": 1, "home": 2, "reset_emergency": 254}


def main():
    cmd = os.environ.get("OM_CMD", "")
    rospy.init_node("om_editor_control", anonymous=True, disable_signals=True)
    if cmd == "stop":
        rospy.wait_for_service("/ll/_service/emergency", timeout=8.0)
        proxy = rospy.ServiceProxy("/ll/_service/emergency", EmergencyStopSrv)
        req = EmergencyStopSrvRequest()
        req.emergency = 1
        proxy(req)
    elif cmd in HIGH_LEVEL:
        rospy.wait_for_service("/mower_service/high_level_control", timeout=8.0)
        proxy = rospy.ServiceProxy("/mower_service/high_level_control", HighLevelControlSrv)
        req = HighLevelControlSrvRequest()
        req.command = HIGH_LEVEL[cmd]
        proxy(req)
    else:
        print(json.dumps({"ok": False, "error": "unknown command"}))
        return
    print(json.dumps({"ok": True, "command": cmd}))


try:
    main()
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)[:200]}))
`;

function buildControlBash() {
  return buildRosPythonBash(CONTROL_PY, { tmpName: "om_control.py", exec: "timeout 15 python3" });
}

const controlDisabled = String(process.env.OPENMOWER_CONTROL_DISABLE || "").trim() === "1";
const CONTROL_COMMANDS = new Set(["start", "stop", "home", "reset_emergency"]);

/** Parse rostopic echo text (YAML-ish) for map HUD / tooltips. Percents normalized to 0–100. */
function extractRosTelemetry(topic, raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return null;
  }
  const t = (topic || "").toLowerCase();
  const pickNum = (key) => {
    const m = trimmed.match(new RegExp(`^${key}:\\s*([-+0-9.eE]+)`, "im"));
    if (!m) {
      return null;
    }
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  };
  const pickBool = (key) => {
    const m = trimmed.match(
      new RegExp(`^${key}:\\s*(True|False|true|false|0|1)(?:\\s|$)`, "im")
    );
    if (!m) {
      return null;
    }
    const v = m[1].toLowerCase();
    return v === "true" || v === "1";
  };
  const pickQuoted = (key) => {
    const m = trimmed.match(new RegExp(`^${key}:\\s*"([^"]*)"`, "im"));
    return m ? m[1].trim() : null;
  };

  const out = {};

  if (t.includes("mower_logic") || /state_name:/m.test(trimmed)) {
    const sn = pickQuoted("state_name");
    if (sn) {
      out.stateName = sn;
    }
    const sub = pickQuoted("sub_state_name");
    if (sub) {
      out.subStateName = sub;
    }
    let bat = pickNum("battery_percent");
    if (bat != null && bat >= 0 && bat <= 1.05) {
      bat *= 100;
    }
    if (bat != null && bat >= 0 && bat <= 100) {
      out.batteryPercent = bat;
    }
    let gps = pickNum("gps_quality_percent");
    if (gps != null && gps >= 0 && gps <= 1.05) {
      gps *= 100;
    }
    if (gps != null && gps >= 0 && gps <= 100) {
      out.gpsQualityPercent = gps;
    }
    const ch = pickBool("is_charging");
    if (ch != null) {
      out.isCharging = ch;
    }
    const em = pickBool("emergency");
    if (em != null) {
      out.emergency = em;
    }
    const st = pickNum("state");
    if (st != null) {
      out.stateCode = st;
    }
  }

  if (t.includes("emergency") || /active_emergency:/m.test(trimmed)) {
    const ae = pickBool("active_emergency");
    if (ae != null) {
      out.activeEmergency = ae;
    }
    const le = pickBool("latched_emergency");
    if (le != null) {
      out.latchedEmergency = le;
    }
    const r =
      trimmed.match(/^reason:\s*'([^']*)'/im) || trimmed.match(/^reason:\s*"([^"]*)"/im);
    if (r && r[1].trim()) {
      out.emergencyReason = r[1].trim();
    }
  }

  if (t.includes("mower_status") || /mower_esc_temperature:/m.test(trimmed)) {
    const ch = pickBool("is_charging");
    if (ch != null) {
      out.isCharging = ch;
    }
    const me = pickBool("mow_enabled");
    if (me != null) {
      out.mowEnabled = me;
    }
    const rd = pickBool("rain_detected");
    if (rd != null) {
      out.rainDetected = rd;
    }
    const escT = pickNum("mower_esc_temperature");
    if (escT != null && escT >= -40 && escT < 120) {
      out.escTempC = escT;
    }
    const rpm = pickNum("mower_motor_rpm");
    if (rpm != null) {
      out.mowerMotorRpm = rpm;
    }
  }

  return Object.keys(out).length ? out : null;
}

/** Drives map icon: nav / docking / dock charging / dock full / emergency / error */
function computeRosVisualMode(health, telemetry) {
  if (health === "emergency") {
    return "emergency";
  }
  if (health === "error") {
    return "error";
  }
  const stateRaw = String(telemetry?.stateName ?? "");
  const stateUp = stateRaw.toUpperCase().replace(/\s+/g, "_");

  const docking =
    /(GOING_TO_DOCK|RETURN_TO_DOCK|NAV_TO_DOCK|DOCKING|APPROACH_DOCK|DOCK_NAV|FIND_DOCK|SEARCH_DOCK|TO_DOCK)/i.test(
      stateRaw
    ) && !/UNDOCK/i.test(stateRaw);

  if (docking) {
    return "docking";
  }

  if (telemetry?.isCharging === true) {
    return "dock_charging";
  }

  const bat = telemetry?.batteryPercent;
  if (
    telemetry?.isCharging === false &&
    Number.isFinite(bat) &&
    bat >= 88 &&
    /CHARGING_COMPLETE|DOCKED|AT_DOCK|FULL|STANDBY_DOCK|IDLE_DOCK|PARK_DOCK/i.test(stateUp)
  ) {
    return "dock_full";
  }

  return "nav";
}

function summarizeRosSnippet(topic, raw) {
  const trimmed = (raw || "").trim();
  const firstLine = trimmed.split(/\r?\n/).find((l) => l.trim()) || "";
  let health = "unknown";
  let summary = topic ? `Topic: ${topic}` : "ROS status";
  const blob = `${trimmed}\n${topic || ""}`.toLowerCase();
  const telemetry = extractRosTelemetry(topic, trimmed);

  const stateNameQuoted = trimmed.match(/state_name:\s*"([^"]*)"/);
  const stateNameVal = (stateNameQuoted?.[1] ?? "").trim();
  const reasonQuoted =
    trimmed.match(/reason:\s*'([^']*)'/) || trimmed.match(/reason:\s*"([^"]*)"/);
  const reasonVal = (reasonQuoted?.[1] ?? "").trim();

  const activeEmerg = /active_emergency:\s*true/i.test(trimmed);
  const latchedEmerg = /latched_emergency:\s*true/i.test(trimmed);
  const highLevelEmerg = /\bemergency:\s*true\b/i.test(trimmed);

  if (activeEmerg || latchedEmerg || highLevelEmerg) {
    health = "emergency";
    const parts = [];
    if (activeEmerg && latchedEmerg) {
      parts.push("Emergency (active + latched)");
    } else if (activeEmerg) {
      parts.push("Emergency (active)");
    } else if (latchedEmerg) {
      parts.push("Latched emergency");
    } else {
      parts.push("Emergency");
    }
    if (stateNameVal) {
      parts.push(stateNameVal);
    }
    if (reasonVal) {
      parts.push(`Reason: ${reasonVal}`);
    }
    summary = parts.join(" · ");
    return {
      topic: topic || null,
      summary,
      health,
      telemetry,
      visualMode: computeRosVisualMode(health, telemetry),
      rawSample: trimmed.slice(0, 420),
    };
  }

  if (/error|fault|stuck|fail/.test(blob)) {
    health = "error";
    summary = "Fault / error in status message";
  } else if (/\bis_charging:\s*true\b/i.test(trimmed)) {
    health = "charging";
    summary = "Charging";
  } else if (/mow|mowing|cut|coverage|idle|pause|driving|nav/.test(blob)) {
    health = "ok";
    summary = firstLine.slice(0, 100) || summary;
  } else if (trimmed) {
    summary = firstLine.slice(0, 100) || summary;
  }

  if (telemetry?.isCharging === true && health !== "emergency" && health !== "error") {
    health = "charging";
  }

  return {
    topic: topic || null,
    summary,
    health,
    telemetry,
    visualMode: computeRosVisualMode(health, telemetry),
    rawSample: trimmed.slice(0, 420),
  };
}

function parseRobotProbeOutput(text) {
  const full = text.trim();
  if (!full) {
    return { ok: false, error: "Empty response from pose probe", liveRobotFatal: false, ros: null };
  }
  const lines = full.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let ros = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === "EXTRA_BEGIN") {
      const endIdx = lines.indexOf("EXTRA_END", i + 1);
      if (endIdx > i) {
        const chunkLines = lines.slice(i + 1, endIdx);
        const topicLine = chunkLines.find((l) => l.startsWith("topic:"));
        const topic = topicLine ? topicLine.slice(6).trim() : null;
        const dataLines = chunkLines.filter((l) => !l.startsWith("topic:"));
        const raw = dataLines.join("\n");
        ros = summarizeRosSnippet(topic, raw);
      }
      break;
    }
  }

  let wifi = null;
  const wifiBegin = lines.indexOf("WIFI_BEGIN");
  const wifiEnd = lines.indexOf("WIFI_END", wifiBegin + 1);
  if (wifiBegin >= 0 && wifiEnd > wifiBegin) {
    for (const line of lines.slice(wifiBegin + 1, wifiEnd)) {
      const match = line.match(/^([^:\s]+):\s+\S+\s+([-+\d.]+)\s+([-+\d.]+)/);
      if (!match) continue;
      const linkQuality = Number(match[2]);
      const signalDbm = Number(match[3]);
      if (!Number.isFinite(signalDbm)) continue;
      const percent = Math.max(0, Math.min(100, Math.round((signalDbm + 100) * 2)));
      wifi = {
        interface: match[1],
        signalDbm,
        linkQuality: Number.isFinite(linkQuality) ? linkQuality : null,
        linkQualityMax: 70,
        percent,
      };
      break;
    }
  }

  const okLine = [...lines].reverse().find((l) => l.startsWith("OK "));
  const errLine = lines.find((l) => l.startsWith("ERR "));

  if (okLine) {
    const parts = okLine.slice(3).trim().split(/\s+/);
    if (parts.length < 5) {
      return {
        ok: false,
        error: "Malformed pose line",
        liveRobotFatal: false,
        ros,
      };
    }
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const yaw = Number(parts[2]);
    const parentFrame = parts[3];
    const childFrame = parts[4];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(yaw)) {
      return {
        ok: false,
        error: "Non-numeric pose fields",
        liveRobotFatal: false,
        ros,
      };
    }
    return {
      ok: true,
      x,
      y,
      yaw,
      frameParent: parentFrame,
      frameChild: childFrame,
      units: "meters_map_frame",
      ros,
      wifi,
      liveRobotFatal: false,
    };
  }

  if (errLine) {
    return {
      ok: false,
      error: errLine.slice(4).trim() || "Unknown TF error",
      liveRobotFatal: false,
      ros,
    };
  }

  return {
    ok: false,
    error: full.slice(0, 200),
    liveRobotFatal: false,
    ros,
  };
}

async function dockerExecInContainer(container, cmd, env = []) {
  const create = await dockerApiRequest(
    "POST",
    `/containers/${encodeURIComponent(container)}/exec`,
    {
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env: env,
      Cmd: cmd,
    }
  );
  if (create.statusCode < 200 || create.statusCode >= 300) {
    let detail = create.body;
    try {
      const parsed = JSON.parse(create.body);
      if (parsed?.message) detail = parsed.message;
    } catch (_e) {
      /* keep body string */
    }
    throw new Error(`exec create failed (${create.statusCode}): ${detail}`);
  }
  let execId;
  try {
    execId = JSON.parse(create.body).Id;
  } catch (_e) {
    throw new Error("exec create returned invalid JSON");
  }
  if (!execId) {
    throw new Error("exec create missing Id");
  }

  const start = await dockerApiRequest(
    "POST",
    `/exec/${execId}/start`,
    {
      Detach: false,
      Tty: false,
    },
    { binaryBody: true }
  );
  if (start.statusCode < 200 || start.statusCode >= 300) {
    const errText =
      Buffer.isBuffer(start.body) ? start.body.toString("utf8") : String(start.body);
    throw new Error(`exec start failed (${start.statusCode}): ${errText}`);
  }

  return demuxDockerStream(start.body);
}

function demuxDockerStream(raw) {
  if (!Buffer.isBuffer(raw)) {
    return { stdout: String(raw || ""), stderr: "" };
  }
  let stdoutChunks = [];
  let stderrChunks = [];
  let offset = 0;
  while (offset + 8 <= raw.length) {
    const streamType = raw.readUInt8(offset);
    const len = raw.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + len;
    if (end > raw.length) break;
    const chunk = raw.subarray(start, end);
    if (streamType === 1) stdoutChunks.push(chunk);
    else if (streamType === 2) stderrChunks.push(chunk);
    offset = end;
  }
  if (stdoutChunks.length === 0 && stderrChunks.length === 0 && raw.length) {
    return { stdout: raw.toString("utf8"), stderr: "" };
  }
  return {
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
  };
}

/**
 * Start a *long-lived* docker exec and stream its stdout incrementally (unlike
 * dockerExecInContainer, which buffers until the process exits). Demuxes the
 * multiplexed attach stream frame-by-frame as bytes arrive. Returns a handle
 * with kill(); handlers.onStdout(Buffer), onStderr(Buffer), onExit(err|null).
 */
async function startDockerExecStream(container, cmd, handlers) {
  const create = await dockerApiRequest(
    "POST",
    `/containers/${encodeURIComponent(container)}/exec`,
    { AttachStdout: true, AttachStderr: true, Tty: false, Cmd: cmd }
  );
  if (create.statusCode < 200 || create.statusCode >= 300) {
    throw new Error(`exec create failed (${create.statusCode}): ${create.body}`);
  }
  let execId;
  try {
    execId = JSON.parse(create.body).Id;
  } catch (_e) {
    throw new Error("exec create returned invalid JSON");
  }
  if (!execId) throw new Error("exec create missing Id");

  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: dockerSocketPath,
        path: `/exec/${execId}/start`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
          res.resume();
          reject(new Error(`exec start failed (${res.statusCode})`));
          return;
        }
        let buf = Buffer.alloc(0);
        res.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          // Demux Docker's 8-byte-header multiplexed frames as they stream in.
          while (buf.length >= 8) {
            const type = buf.readUInt8(0);
            const len = buf.readUInt32BE(4);
            if (buf.length < 8 + len) break;
            const payload = buf.subarray(8, 8 + len);
            buf = buf.subarray(8 + len);
            if (type === 2) handlers.onStderr?.(payload);
            else handlers.onStdout?.(payload);
          }
        });
        res.on("end", () => handlers.onExit?.(null));
        res.on("error", (err) => handlers.onExit?.(err));
        resolve({
          kill() {
            try {
              res.destroy();
            } catch (_e) {
              /* ignore */
            }
            try {
              req.destroy();
            } catch (_e) {
              /* ignore */
            }
          },
        });
      }
    );
    req.on("error", reject);
    req.write(JSON.stringify({ Detach: false, Tty: false }));
    req.end();
  });
}

async function inspectPoseContainer() {
  const r = await dockerApiRequest(
    "GET",
    `/containers/${encodeURIComponent(poseContainerName)}/json`
  );
  if (r.statusCode === 404) {
    let msg = `No such container: ${poseContainerName}`;
    try {
      const parsed = JSON.parse(r.body);
      if (parsed?.message) msg = parsed.message;
    } catch (_e) {
      /* keep default */
    }
    return {
      ok: false,
      error: msg,
      container: {
        name: poseContainerName,
        exists: false,
        running: false,
        status: "missing",
      },
    };
  }
  if (r.statusCode < 200 || r.statusCode >= 300) {
    return {
      ok: false,
      error: `docker inspect failed (${r.statusCode})`,
      container: {
        name: poseContainerName,
        exists: null,
        running: false,
        status: "unknown",
      },
    };
  }
  let j;
  try {
    j = JSON.parse(r.body);
  } catch (_e) {
    return {
      ok: false,
      error: "docker inspect returned invalid JSON",
      container: null,
    };
  }
  const running = j.State?.Running === true;
  const status = j.State?.Status || "unknown";
  return {
    ok: true,
    container: {
      name: poseContainerName,
      exists: true,
      running,
      status,
      restartCount: j.RestartCount ?? 0,
      startedAt: j.State?.StartedAt || null,
    },
  };
}

async function fetchRobotPoseFromRosContainer() {
  if (poseDisabled) {
    return {
      ok: false,
      error: "Robot pose disabled via OPENMOWER_POSE_DISABLE=1",
      liveRobotFatal: true,
      ros: null,
    };
  }
  const bashCmd = buildRobotPoseProbeBash();
  const { stdout, stderr } = await dockerExecInContainer(poseContainerName, [
    "/bin/bash",
    "-lc",
    bashCmd,
  ]);
  const trimmedErr = stderr.trim();
  if (trimmedErr) {
    logWarn("Robot pose stderr", { container: poseContainerName, stderr: trimmedErr });
  }
  return parseRobotProbeOutput(stdout || stderr || "");
}

async function collectAutonomousWifiSample() {
  const startedAt = Date.now();
  const { stdout, stderr } = await dockerExecInContainer(poseContainerName, [
    "/bin/bash",
    "-lc",
    buildWifiCollectorProbeBash(),
  ]);
  const probe = parseRobotProbeOutput(stdout || stderr || "");
  if (
    !probe.ok ||
    probe.frameParent !== "map" ||
    !Number.isFinite(probe.x) ||
    !Number.isFinite(probe.y) ||
    !Number.isFinite(probe.wifi?.signalDbm)
  ) {
    throw new Error(probe.error || "WiFi collector probe returned no map pose or signal");
  }

  await ensureWifiSurveyLoaded();
  const now = Date.now();
  const key = wifiCellKey(probe.x, probe.y);
  const previous = wifiSurvey.get(key);
  const previousAgeMs = previous ? now - Number(previous.timestamp || 0) : Infinity;
  const signalChangeDbm = previous
    ? Math.abs(Number(previous.signalDbm) - probe.wifi.signalDbm)
    : Infinity;
  const shouldStore =
    !previous ||
    (previousAgeMs >= wifiCollectorCellRevisitMs && signalChangeDbm >= 3);

  wifiCollectorSuccessCount += 1;
  wifiCollectorLastCollectedAt = now;
  wifiCollectorLastSignalDbm = probe.wifi.signalDbm;
  wifiCollectorLastInterface = probe.wifi.interface || null;
  wifiCollectorLastDurationMs = now - startedAt;
  wifiCollectorLastError = null;

  if (
    shouldStore &&
    mergeWifiSurveySample({
      x: probe.x,
      y: probe.y,
      signalDbm: probe.wifi.signalDbm,
    })
  ) {
    wifiCollectorStoredCount += 1;
    wifiCollectorLastStoredAt = Date.now();
    return true;
  }
  return false;
}

function scheduleAutonomousWifiCollector(delayMs = wifiCollectorIntervalMs) {
  if (wifiCollectorDisabled || poseDisabled || wifiCollectorStopped || wifiCollectorTimer) return;
  wifiCollectorTimer = setTimeout(async () => {
    wifiCollectorTimer = null;
    if (wifiCollectorInFlight) {
      scheduleAutonomousWifiCollector();
      return;
    }
    wifiCollectorInFlight = true;
    const startedAt = Date.now();
    try {
      await collectAutonomousWifiSample();
    } catch (error) {
      wifiCollectorFailureCount += 1;
      wifiCollectorLastDurationMs = Date.now() - startedAt;
      wifiCollectorLastError = error.message || "WiFi collector failed";
      if (wifiCollectorFailureCount === 1 || wifiCollectorFailureCount % 30 === 0) {
        logWarn("Autonomous WiFi collector failed", {
          failures: wifiCollectorFailureCount,
          error: wifiCollectorLastError,
        });
      }
    } finally {
      wifiCollectorInFlight = false;
      const elapsedMs = Date.now() - startedAt;
      scheduleAutonomousWifiCollector(Math.max(1000, wifiCollectorIntervalMs - elapsedMs));
    }
  }, delayMs);
  wifiCollectorTimer.unref?.();
}

function startAutonomousWifiCollector() {
  if (wifiCollectorDisabled || poseDisabled) {
    logInfo("Autonomous WiFi collector disabled", {
      wifiCollectorDisabled,
      poseDisabled,
    });
    return;
  }
  wifiCollectorStopped = false;
  logInfo("Autonomous WiFi collector enabled", {
    intervalMs: wifiCollectorIntervalMs,
    tfTimeoutSec: wifiCollectorTfTimeoutSec,
    cellRevisitMs: wifiCollectorCellRevisitMs,
  });
  scheduleAutonomousWifiCollector(1500);
}

function stopAutonomousWifiCollector() {
  wifiCollectorStopped = true;
  if (!wifiCollectorTimer) return;
  clearTimeout(wifiCollectorTimer);
  wifiCollectorTimer = null;
}

async function getRobotPoseCached() {
  const now = Date.now();
  if (robotPoseCache.payload && robotPoseCache.expiresAt > now) {
    return { ...robotPoseCache.payload, cached: true };
  }
  if (robotPosePromise) {
    return robotPosePromise;
  }
  robotPosePromise = (async () => {
    try {
      if (poseDisabled) {
        const payload = {
          ok: false,
          error: "Robot pose disabled via OPENMOWER_POSE_DISABLE=1",
          liveRobotFatal: true,
          container: null,
          ros: null,
        };
        robotPoseCache = {
          expiresAt: Date.now() + poseCacheMs,
          payload,
        };
        return { ...payload, cached: false };
      }

      const inspect = await inspectPoseContainer();
      if (!inspect.ok) {
        const payload = {
          ok: false,
          error: inspect.error,
          container: inspect.container,
          ros: null,
          liveRobotFatal: true,
        };
        robotPoseCache = {
          expiresAt: Date.now() + Math.min(poseCacheMs, 2000),
          payload,
        };
        return { ...payload, cached: false };
      }
      if (!inspect.container.running) {
        const payload = {
          ok: false,
          error: `Container '${poseContainerName}' is not running (${inspect.container.status})`,
          container: inspect.container,
          ros: null,
          liveRobotFatal: true,
        };
        robotPoseCache = {
          expiresAt: Date.now() + Math.min(poseCacheMs, 2000),
          payload,
        };
        return { ...payload, cached: false };
      }

      let posePayload;
      try {
        posePayload = await fetchRobotPoseFromRosContainer();
      } catch (error) {
        const payload = {
          ok: false,
          error: error.message || "Docker exec failed (is the socket mounted?)",
          container: inspect.container,
          ros: null,
          liveRobotFatal: true,
        };
        robotPoseCache = {
          expiresAt: Date.now() + Math.min(poseCacheMs, 2000),
          payload,
        };
        logWarn("Robot pose exec failed", {
          container: poseContainerName,
          error: error.message,
        });
        return { ...payload, cached: false };
      }

      const payload = {
        ...posePayload,
        container: inspect.container,
        liveRobotFatal: posePayload.liveRobotFatal === true,
      };
      robotPoseCache = {
        expiresAt: Date.now() + poseCacheMs,
        payload,
      };
      return { ...payload, cached: false };
    } catch (error) {
      const payload = {
        ok: false,
        error: error.message || "Robot pose request failed",
        container: null,
        ros: null,
        liveRobotFatal: true,
      };
      robotPoseCache = {
        expiresAt: Date.now() + Math.min(poseCacheMs, 2000),
        payload,
      };
      logWarn("Robot pose request failed", {
        container: poseContainerName,
        error: error.message,
      });
      return { ...payload, cached: false };
    } finally {
      robotPosePromise = null;
    }
  })();
  return robotPosePromise;
}

// ---- live pose streamer (persistent subscriber → SSE) ----------------------

const robotStream = {
  handle: null,
  starting: false,
  ready: false,
  lastError: null,
  pose: null, // { x, y, yaw, acc, flags }
  poseAt: 0,
  telemetry: null,
  lineBuf: "",
  clients: new Set(), // Set<http.ServerResponse>
  lastPollAt: 0, // last /api/robot_pose hit (keeps stream warm for pollers)
  reconnectTimer: null,
  reconnectDelay: 1000,
};

/** Normalize a 0–1 or 0–100 ratio to a 0–100 percent, or null. */
function toPercent(v) {
  if (!Number.isFinite(v) || v < 0) return null;
  const pct = v <= 1.05 ? v * 100 : v;
  return pct >= 0 && pct <= 100 ? pct : null;
}

/** Convert a streamed `S` (RobotState) frame into the telemetry shape the UI reads. */
function stateFrameToTelemetry(s) {
  const t = {};
  if (s.state) t.stateName = String(s.state);
  if (s.sub) t.subStateName = String(s.sub);
  const bat = toPercent(Number(s.batt));
  if (bat != null) t.batteryPercent = bat;
  const gps = toPercent(Number(s.gps));
  if (gps != null) t.gpsQualityPercent = gps;
  if (typeof s.charging === "boolean") t.isCharging = s.charging;
  if (typeof s.emergency === "boolean") t.emergency = s.emergency;
  if (typeof s.rain === "boolean") t.rainDetected = s.rain;
  return t;
}

/** RTK label from AbsolutePose flags (FIXED=2, FLOAT=4, DEAD_RECKONING=8). */
function rtkLabel(flags) {
  if (!Number.isFinite(flags)) return null;
  if (flags & 2) return "RTK fixed";
  if (flags & 4) return "RTK float";
  if (flags & 8) return "dead reckoning";
  return null;
}

/** Merge the latest streamed pose + telemetry into the /api/robot_pose payload shape. */
function liveSampleToPayload() {
  if (!robotStream.pose) return null;
  const p = robotStream.pose;
  const telemetry = robotStream.telemetry;
  const rtk = rtkLabel(p.flags);
  const ros = telemetry
    ? {
        telemetry,
        health: telemetry.emergency ? "emergency" : "ok",
        summary: rtk || undefined,
      }
    : rtk
      ? { summary: rtk }
      : null;
  return {
    ok: true,
    x: p.x,
    y: p.y,
    yaw: p.yaw,
    frameParent: "map",
    frameChild: "base_link",
    units: "meters_map_frame",
    positionAccuracy: Number.isFinite(p.acc) ? p.acc : null,
    gpsRtk: rtk,
    ros,
    liveRobotFatal: false,
    source: "stream",
  };
}

function robotStreamHasFreshPose() {
  return robotStream.pose != null && Date.now() - robotStream.poseAt < liveStreamFreshMs;
}

function writeSse(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (_e) {
    /* client gone; cleaned up on 'close' */
  }
}

/** Push the current best sample to every connected SSE client. */
function broadcastLivePose() {
  if (robotStream.clients.size === 0) return;
  const payload = liveSampleToPayload();
  if (!payload) return;
  // Serialize once, then write the shared frame to every client.
  const frame = `data: ${JSON.stringify({ container: poseContainerName, ...payload })}\n\n`;
  for (const res of robotStream.clients) {
    try {
      res.write(frame);
    } catch (_e) {
      /* client gone; cleaned up on 'close' */
    }
  }
}

function handleStreamLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (_e) {
    return;
  }
  if (msg.t === "R") {
    robotStream.ready = true;
    robotStream.lastError = null;
    return;
  }
  if (msg.t === "P") {
    if (Number.isFinite(msg.x) && Number.isFinite(msg.y) && Number.isFinite(msg.yaw)) {
      robotStream.pose = { x: msg.x, y: msg.y, yaw: msg.yaw, acc: msg.acc, flags: msg.flags };
      robotStream.poseAt = Date.now();
      broadcastLivePose();
    }
    return;
  }
  if (msg.t === "S") {
    robotStream.telemetry = stateFrameToTelemetry(msg);
    broadcastLivePose();
  }
}

function feedStreamChunk(buf) {
  robotStream.lineBuf += buf.toString("utf8");
  if (robotStream.lineBuf.length > 65536) {
    // Runaway without newlines — drop to avoid unbounded growth.
    robotStream.lineBuf = robotStream.lineBuf.slice(-4096);
  }
  let idx;
  while ((idx = robotStream.lineBuf.indexOf("\n")) >= 0) {
    const line = robotStream.lineBuf.slice(0, idx);
    robotStream.lineBuf = robotStream.lineBuf.slice(idx + 1);
    handleStreamLine(line);
  }
}

function scheduleStreamReconnect() {
  if (robotStream.reconnectTimer) return;
  if (!streamStillWanted()) return;
  const delay = robotStream.reconnectDelay;
  robotStream.reconnectDelay = Math.min(delay * 2, 15000);
  robotStream.reconnectTimer = setTimeout(() => {
    robotStream.reconnectTimer = null;
    ensureRobotStream();
  }, delay);
}

/** Do we still need the subscriber running (SSE clients, or a recent poller)? */
function streamStillWanted() {
  return (
    robotStream.clients.size > 0 || Date.now() - robotStream.lastPollAt < liveStreamFreshMs * 3
  );
}

/** Lazily (re)start the persistent subscriber. No-op if disabled or already up. */
async function ensureRobotStream() {
  if (poseDisabled || robotStream.handle || robotStream.starting) return;
  if (!streamStillWanted()) return;
  robotStream.starting = true;
  try {
    const inspect = await inspectPoseContainer();
    if (!inspect.ok || !inspect.container.running) {
      robotStream.lastError = inspect.ok
        ? `Container '${poseContainerName}' is not running`
        : inspect.error;
      scheduleStreamReconnect();
      return;
    }
    const handle = await startDockerExecStream(
      poseContainerName,
      ["/bin/bash", "-lc", buildRobotStreamBash()],
      {
        onStdout: (chunk) => feedStreamChunk(chunk),
        onStderr: (chunk) => {
          const s = chunk.toString("utf8").trim();
          if (s) robotStream.lastError = s.slice(0, 200);
        },
        onExit: () => {
          robotStream.handle = null;
          robotStream.ready = false;
          logWarn("Robot pose stream ended", {
            container: poseContainerName,
            lastError: robotStream.lastError || null,
          });
          scheduleStreamReconnect();
        },
      }
    );
    robotStream.handle = handle;
    robotStream.reconnectDelay = 1000;
    logInfo("Robot pose stream started", { container: poseContainerName });
  } catch (error) {
    robotStream.lastError = error.message || "stream start failed";
    logWarn("Robot pose stream start failed", { error: robotStream.lastError });
    scheduleStreamReconnect();
  } finally {
    robotStream.starting = false;
  }
}

function stopRobotStream() {
  if (robotStream.reconnectTimer) {
    clearTimeout(robotStream.reconnectTimer);
    robotStream.reconnectTimer = null;
  }
  if (robotStream.handle) {
    robotStream.handle.kill();
    robotStream.handle = null;
  }
  robotStream.ready = false;
  robotStream.lineBuf = "";
}

async function restartOpenMowerContainer() {
  logInfo("Restart requested for container", { container: restartContainerName });
  const inspect = await dockerApiRequest(
    "GET",
    `/containers/${encodeURIComponent(restartContainerName)}/json`
  );
  if (inspect.statusCode === 404) {
    logWarn("Restart skipped: container not found", { container: restartContainerName });
    return {
      restarted: false,
      reason: `Container '${restartContainerName}' not found`,
    };
  }
  if (inspect.statusCode < 200 || inspect.statusCode >= 300) {
    logWarn("Restart skipped: docker inspect failed", {
      container: restartContainerName,
      statusCode: inspect.statusCode,
    });
    return {
      restarted: false,
      reason: `Docker inspect failed with status ${inspect.statusCode}`,
    };
  }

  const restart = await dockerApiRequest(
    "POST",
    `/containers/${encodeURIComponent(restartContainerName)}/restart`
  );
  if (restart.statusCode < 200 || restart.statusCode >= 299) {
    logWarn("Restart failed", {
      container: restartContainerName,
      statusCode: restart.statusCode,
    });
    return {
      restarted: false,
      reason: `Docker restart failed with status ${restart.statusCode}`,
    };
  }

  logInfo("Container restarted", { container: restartContainerName });
  return { restarted: true };
}

app.get("/api/params", async (_req, res) => {
  try {
    if (verboseLogs) logInfo("Reading mower params", { file: paramsPath });
    const content = await fs.readFile(paramsPath, "utf8");
    const parsed = yaml.load(content);
    const datum = extractGpsDatum(parsed);
    if (!datum) {
      logWarn("Missing datum_lat/datum_long in params file", { file: paramsPath });
      return res.status(422).json({
        error: "datum_lat/datum_long not found in mower_params.yaml",
      });
    }
    if (verboseLogs) logInfo("Loaded mower params datum", datum);
    return res.json(datum);
  } catch (error) {
    if (error.code === "ENOENT") {
      logWarn("Params file not found", { file: paramsPath });
      return res.status(404).json({ error: "mower_params.yaml not found" });
    }
    logError("Failed to read mower params", { file: paramsPath, error: error.message });
    return res.status(500).json({ error: "Failed to read mower params" });
  }
});

// ---- mowing parameters (/mower_logic), for the accurate coverage preview ----
// OpenMower cfg defaults (MowerLogic.cfg) — used when neither ROS nor the YAML
// has a value. `tool_width` is global (blade width); the per-area overrides
// (outline_count / outline_overlap_count / outline_offset / angle) live in
// map.json under area.properties and are handled client-side.
const MOW_PARAM_DEFAULTS = {
  toolWidth: 0.14,
  outlineCount: 3,
  outlineOverlapCount: 0,
  outlineOffset: 0,
  mowAngleOffset: 0,
  mowAngleOffsetIsAbsolute: false,
};
const MOW_PARAM_KEYS = {
  tool_width: "toolWidth",
  outline_count: "outlineCount",
  outline_overlap_count: "outlineOverlapCount",
  outline_offset: "outlineOffset",
  mow_angle_offset: "mowAngleOffset",
  mow_angle_offset_is_absolute: "mowAngleOffsetIsAbsolute",
};

function buildMowParamsBash() {
  const lines = [
    "set +e",
    "for S in /opt/ros/noetic/setup.bash /opt/ros/humble/setup.bash /opt/ros/jazzy/setup.bash /opt/ros/iron/setup.bash; do [ -f \"$S\" ] && . \"$S\" && break; done",
    "for W in /opt/open_mower_ros/devel/setup.bash /ros_ws/install/setup.bash /root/*/devel/setup.bash; do [ -f \"$W\" ] && . \"$W\" && break; done",
  ];
  for (const rosKey of Object.keys(MOW_PARAM_KEYS)) {
    lines.push(`printf '${rosKey}=%s\\n' "$(rosparam get /mower_logic/${rosKey} 2>/dev/null)"`);
  }
  return lines.join("\n");
}

function coerceMowParam(camelKey, raw) {
  const value = String(raw).trim();
  if (value === "") return undefined;
  if (camelKey === "mowAngleOffsetIsAbsolute") return /^true$/i.test(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseMowParamsOutput(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^([a-z_]+)=(.*)$/);
    if (!m) continue;
    const camelKey = MOW_PARAM_KEYS[m[1]];
    if (!camelKey) continue;
    const v = coerceMowParam(camelKey, m[2]);
    if (v !== undefined) out[camelKey] = v;
  }
  return out;
}

async function readMowParamsFromYaml() {
  try {
    const parsed = yaml.load(await fs.readFile(paramsPath, "utf8"));
    const ml = parsed?.mower_logic || {};
    const out = {};
    for (const [rosKey, camelKey] of Object.entries(MOW_PARAM_KEYS)) {
      if (ml[rosKey] !== undefined) {
        const v = coerceMowParam(camelKey, ml[rosKey]);
        if (v !== undefined) out[camelKey] = v;
      }
    }
    return out;
  } catch (_e) {
    return {};
  }
}

let mowParamsCache = { expiresAt: 0, payload: null };

async function getMowParams() {
  const now = Date.now();
  if (mowParamsCache.payload && mowParamsCache.expiresAt > now) return mowParamsCache.payload;

  let source = "default";
  let params = { ...MOW_PARAM_DEFAULTS };

  const fromYaml = await readMowParamsFromYaml();
  if (Object.keys(fromYaml).length) {
    params = { ...params, ...fromYaml };
    source = "file";
  }

  if (!poseDisabled) {
    try {
      const { stdout } = await dockerExecInContainer(poseContainerName, [
        "/bin/bash",
        "-lc",
        buildMowParamsBash(),
      ]);
      const live = parseMowParamsOutput(stdout);
      if (Object.keys(live).length) {
        params = { ...params, ...live };
        source = "live";
      }
    } catch (error) {
      logWarn("Mow params live read failed; using file/defaults", { error: error.message });
    }
  }

  const payload = { ok: true, source, ...params };
  mowParamsCache = { expiresAt: Date.now() + 15000, payload };
  return payload;
}

app.get("/api/mow_params", async (_req, res) => {
  try {
    return res.json(await getMowParams());
  } catch (error) {
    logError("Mow params endpoint failed", { error: error.message });
    return res.json({ ok: false, source: "default", ...MOW_PARAM_DEFAULTS });
  }
});

app.get("/api/robot_pose", async (_req, res) => {
  try {
    robotStream.lastPollAt = Date.now();
    ensureRobotStream();
    // Prefer a fresh streamed sample (smooth, ~20 Hz); else the tf_echo probe.
    const result = robotStreamHasFreshPose()
      ? liveSampleToPayload()
      : await getRobotPoseCached();
    const body = JSON.stringify({
      container: poseContainerName,
      ...result,
    });
    // Avoid Express res.json → res.send ETag / 304 handling: browsers send
    // If-None-Match on poll; 304 + empty body breaks live pose/status updates.
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", Buffer.byteLength(body, "utf8"));
    return res.end(body);
  } catch (error) {
    logError("Robot pose endpoint failed", { error: error.message });
    return res.status(500).json({
      ok: false,
      error: error.message || "robot_pose_failed",
    });
  }
});

/**
 * Server-Sent Events stream of the live pose. Pushes each streamed sample
 * (~20 Hz) the instant it arrives; the browser interpolates between them for
 * smooth motion. When the persistent subscriber isn't producing (ROS2/other
 * setups, or warming up), a 1 Hz tick falls back to the tf_echo probe so the
 * overlay still works — the client needs no fallback logic of its own.
 */
app.get("/api/robot_pose/stream", async (req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(`retry: 3000\n\n`);

  robotStream.clients.add(res);
  robotStream.lastPollAt = Date.now();
  ensureRobotStream();

  // Immediate snapshot so the marker appears without waiting for the next frame.
  if (robotStreamHasFreshPose()) {
    writeSse(res, { container: poseContainerName, ...liveSampleToPayload() });
  }

  // Fallback/heartbeat: when no fresh streamed pose, serve the probe (or status).
  const tick = setInterval(async () => {
    if (robotStreamHasFreshPose()) {
      res.write(`: hb\n\n`); // keep-alive only; pose already pushed on arrival
      return;
    }
    try {
      const probe = await getRobotPoseCached();
      writeSse(res, { container: poseContainerName, ...probe });
    } catch (error) {
      writeSse(res, {
        container: poseContainerName,
        ok: false,
        error: error.message || "robot_pose_failed",
        liveRobotFatal: false,
      });
    }
  }, 1000);

  req.on("close", () => {
    clearInterval(tick);
    robotStream.clients.delete(res);
    if (!streamStillWanted()) stopRobotStream();
  });
});

/**
 * On-demand exact coverage path from OpenMower's own planner. Body carries the
 * mow polygon + holes (obstacles) + resolved params; we run the plan_path script
 * inside the ROS container and return the ordered paths. Cached briefly by request
 * so repeated clicks on an unchanged zone are instant.
 */
app.post("/api/plan_path", async (req, res) => {
  try {
    if (poseDisabled) {
      return res.json({ ok: false, error: "Live robot disabled (OPENMOWER_POSE_DISABLE=1)" });
    }
    const body = req.body || {};
    if (!Array.isArray(body.outline) || body.outline.length < 3) {
      return res.status(400).json({ ok: false, error: "outline must have at least 3 points" });
    }

    const normalized = {
      fill_type: Number(body.fill_type) || 0,
      angle: Number(body.angle) || 0,
      distance: Number(body.distance) > 0 ? Number(body.distance) : 0.14,
      outer_offset: Number(body.outer_offset) || 0,
      outline_count: Math.max(0, Math.round(Number(body.outline_count) || 0)),
      outline_overlap_count: Math.max(0, Math.round(Number(body.outline_overlap_count) || 0)),
      outline: body.outline,
      holes: Array.isArray(body.holes) ? body.holes : [],
    };

    const key = JSON.stringify(normalized);
    const now = Date.now();
    const cached = planPathCache.get(key);
    if (cached && cached.expiresAt > now) {
      return res.json({ ...cached.payload, cached: true });
    }

    const inspect = await inspectPoseContainer();
    if (!inspect.ok || !inspect.container.running) {
      return res.json({
        ok: false,
        error: inspect.ok
          ? `Container '${poseContainerName}' is not running`
          : inspect.error,
      });
    }

    const reqB64 = Buffer.from(key, "utf8").toString("base64");
    const { stdout, stderr } = await dockerExecInContainer(
      poseContainerName,
      ["/bin/bash", "-lc", buildPlanPathBash()],
      [`PLAN_REQ_B64=${reqB64}`]
    );
    const line = (stdout || "").split(/\r?\n/).filter(Boolean).pop() || "";
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (_e) {
      payload = {
        ok: false,
        error: (stderr || stdout || "planner returned no JSON").trim().slice(0, 300),
      };
    }
    if (payload.ok) {
      planPathCache.set(key, { expiresAt: now + PLAN_PATH_CACHE_MS, payload });
      if (planPathCache.size > 24) {
        planPathCache.delete(planPathCache.keys().next().value);
      }
    } else {
      logWarn("plan_path planner error", { container: poseContainerName, error: payload.error });
    }
    return res.json({ ...payload, cached: false });
  } catch (error) {
    logError("plan_path endpoint failed", { error: error.message });
    return res.status(500).json({ ok: false, error: error.message || "plan_path_failed" });
  }
});

/**
 * Whitelisted mower control. Body: { command: start|stop|home|reset_emergency }.
 * Moves a real robot — kept behind an explicit command whitelist and the
 * OPENMOWER_CONTROL_DISABLE kill-switch.
 */
app.post("/api/control", async (req, res) => {
  try {
    if (controlDisabled) {
      return res.json({ ok: false, error: "Mower control disabled (OPENMOWER_CONTROL_DISABLE=1)" });
    }
    const command = String(req.body?.command || "").trim();
    if (!CONTROL_COMMANDS.has(command)) {
      return res.status(400).json({ ok: false, error: "unknown command" });
    }
    const inspect = await inspectPoseContainer();
    if (!inspect.ok || !inspect.container.running) {
      return res.json({
        ok: false,
        error: inspect.ok ? `Container '${poseContainerName}' is not running` : inspect.error,
      });
    }
    const { stdout, stderr } = await dockerExecInContainer(
      poseContainerName,
      ["/bin/bash", "-lc", buildControlBash()],
      [`OM_CMD=${command}`]
    );
    const line = (stdout || "").split(/\r?\n/).filter(Boolean).pop() || "";
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (_e) {
      payload = { ok: false, error: (stderr || stdout || "no response from control").trim().slice(0, 200) };
    }
    logInfo("Mower control command", { command, ok: payload.ok, error: payload.error || null });
    return res.json(payload);
  } catch (error) {
    logError("control endpoint failed", { error: error.message });
    return res.status(500).json({ ok: false, error: error.message || "control_failed" });
  }
});

app.get("/api/wifi-map", async (req, res) => {
  try {
    await ensureWifiSurveyLoaded();
    const knownRevision = Number(req.query.revision);
    res.setHeader("Cache-Control", "no-store");
    if (Number.isFinite(knownRevision) && knownRevision === wifiSurveyRevision) {
      return res.json({ ok: true, notModified: true, ...wifiSurveyMeta() });
    }
    return res.json({ ok: true, ...wifiSurveyMeta(), samples: [...wifiSurvey.values()] });
  } catch (error) {
    logError("Failed to read central WiFi survey", { error: error.message });
    return res.status(500).json({ ok: false, error: "Failed to read WiFi survey" });
  }
});

app.post("/api/wifi-map/samples", async (req, res) => {
  try {
    await ensureWifiSurveyLoaded();
    const samples = Array.isArray(req.body?.samples)
      ? req.body.samples
      : req.body && typeof req.body === "object"
        ? [req.body]
        : [];
    if (samples.length < 1 || samples.length > wifiMaxPoints) {
      return res.status(400).json({
        ok: false,
        error: `Expected 1-${wifiMaxPoints} WiFi samples`,
      });
    }
    let accepted = 0;
    for (const sample of samples) {
      if (mergeWifiSurveySample(sample)) accepted += 1;
    }
    if (!accepted) {
      return res.status(422).json({ ok: false, error: "No valid WiFi samples" });
    }
    return res.json({ ok: true, accepted, ...wifiSurveyMeta() });
  } catch (error) {
    logError("Failed to record central WiFi samples", { error: error.message });
    return res.status(500).json({ ok: false, error: "Failed to record WiFi samples" });
  }
});

app.delete("/api/wifi-map", async (_req, res) => {
  try {
    await ensureWifiSurveyLoaded();
    await flushWifiSurvey(true);
    const clearBackupPath = `${wifiMapPath}.bak-clear`;
    try {
      await fs.copyFile(wifiMapPath, clearBackupPath);
      await applyMowerFileOwnership(clearBackupPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    logWarn("Clearing central WiFi survey", {
      points: wifiSurvey.size,
      backup: clearBackupPath,
    });
    wifiSurvey.clear();
    wifiSurveyDirty = true;
    wifiSurveyRevision += 1;
    wifiSurveyUpdatedAt = Date.now();
    await flushWifiSurvey(true);
    return res.json({ ok: true, ...wifiSurveyMeta() });
  } catch (error) {
    logError("Failed to clear central WiFi survey", { error: error.message });
    return res.status(500).json({ ok: false, error: "Failed to clear WiFi survey" });
  }
});

app.get("/api/map", async (_req, res) => {
  try {
    if (verboseLogs) logInfo("Reading active map file", { file: mapPath });
    const content = await fs.readFile(mapPath, "utf8");
    return res.type("application/json").send(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      logWarn("Active map file not found", { file: mapPath });
      return res.status(404).json({ error: "map.json not found" });
    }
    logError("Failed to read active map file", { file: mapPath, error: error.message });
    return res.status(500).json({ error: "Failed to read map.json" });
  }
});

app.get("/api/map/backups", async (_req, res) => {
  try {
    if (verboseLogs) logInfo("Listing map backups", { directory: mapDirectory });
    const entries = await fs.readdir(mapDirectory, { withFileTypes: true });
    const mapFiles = entries
      .filter((entry) => entry.isFile() && isValidMapFileName(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => {
        if (a === "map.json") return -1;
        if (b === "map.json") return 1;
        return b.localeCompare(a);
      });
    if (verboseLogs) logInfo("Listed map files", { count: mapFiles.length });
    return res.json({ backups: mapFiles });
  } catch (error) {
    logError("Failed to list map backups", { directory: mapDirectory, error: error.message });
    return res.status(500).json({ error: "Failed to list map backups" });
  }
});

app.get("/api/map/backups/:backupName", async (req, res) => {
  try {
    const backupName = req.params.backupName;
    if (!isValidMapFileName(backupName)) {
      return res.status(400).json({ error: "Invalid map file name" });
    }
    const backupPath = path.join(mapDirectory, backupName);
    if (verboseLogs) logInfo("Reading map/backup file", { file: backupPath });
    const content = await fs.readFile(backupPath, "utf8");
    return res.type("application/json").send(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      logWarn("Requested map/backup file not found", { file: req.params.backupName });
      return res.status(404).json({ error: "Backup file not found" });
    }
    logError("Failed to read map/backup file", {
      file: req.params.backupName,
      error: error.message,
    });
    return res.status(500).json({ error: "Failed to read backup file" });
  }
});

app.post("/api/map", async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ error: "Invalid map payload" });
    }

    const restartRequested = shouldRestartFromQuery(req.query.restart);
    logInfo("Saving map file", { file: mapPath, restartRequested });

    const mapJson = JSON.stringify(req.body, null, 2);
    const backupPath = `${mapPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;

    try {
      await fs.copyFile(mapPath, backupPath);
      logInfo("Created map backup before save", { backupPath });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      logWarn("No existing map.json found before save; backup skipped", { file: mapPath });
    }

    await fs.writeFile(mapPath, mapJson, "utf8");
    logInfo("Saved map file", { file: mapPath, bytes: Buffer.byteLength(mapJson, "utf8") });

    if (!restartRequested) {
      return res.json({
        ok: true,
        backupPath,
      });
    }

    let restartResult = {
      restarted: false,
      reason: "Docker restart not attempted",
    };
    try {
      restartResult = await restartOpenMowerContainer();
    } catch (error) {
      logError("Restart failed due to docker socket error", {
        container: restartContainerName,
        error: error.message,
      });
      restartResult = {
        restarted: false,
        reason: `Docker socket unavailable (${error.code || "error"})`,
      };
    }

    return res.json({
      ok: true,
      backupPath,
      restartContainer: restartContainerName,
      restartRequested: true,
      restartResult,
    });
  } catch (error) {
    logError("Failed to save map.json", { file: mapPath, error: error.message });
    return res.status(500).json({ error: "Failed to save map.json" });
  }
});

// SPA fallback: serve the built index.html for any non-API GET so the
// single-page app loads on a hard refresh. API 404s fall through untouched.
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  if (req.method !== "GET") {
    next();
    return;
  }
  res.sendFile(path.join(distDir, "index.html"), (error) => {
    if (error) {
      next();
    }
  });
});

process.on("uncaughtException", (error) => {
  logError("Uncaught exception (process crash)", {
    name: error.name,
    message: error.message,
    stack: error.stack,
  });
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled promise rejection", { reason });
});

const server = app.listen(port, () => {
  logInfo("OpenMower Map Editor listening", {
    port,
    mapPath,
    paramsPath,
    restartContainerName,
    poseContainerName,
    poseCacheMs,
    tfEchoTimeoutSec,
    rosTopicSampleTimeoutSec,
    rosTopicFallbackTimeoutSec,
    poseDisabled,
    verboseLogs,
    dockerSocketPath,
    wifiMapPath,
    wifiCellSizeM,
    wifiMaxPoints,
    wifiFlushMs,
    wifiCollectorIntervalMs,
    wifiCollectorTfTimeoutSec,
    wifiCollectorCellRevisitMs,
    wifiCollectorDisabled,
  });
  startAutonomousWifiCollector();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo("Shutting down", { signal });
  stopAutonomousWifiCollector();
  server.close();
  try {
    await flushWifiSurvey(true);
  } catch (error) {
    logError("Final WiFi survey flush failed", { error: error.message });
  }
  process.exit(0);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

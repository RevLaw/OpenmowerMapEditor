const express = require("express");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const yaml = require("js-yaml");

const app = express();
const port = process.env.PORT || 80;

const paramsPath = "/data/params/mower_params.yaml";
const mapPath = "/data/ros/map.json";
const mapDirectory = path.dirname(mapPath);
const dockerSocketPath = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
const restartContainerName = process.env.OPENMOWER_CONTAINER_NAME || "open_mower_ros";

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

app.use(express.json({ limit: "20mb" }));
app.use(express.static(__dirname));
app.use((req, res, next) => {
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

function dockerApiRequest(method, requestPath) {
  return new Promise((resolve, reject) => {
    logInfo("Docker API request", { method, requestPath, socket: dockerSocketPath });
    const req = http.request(
      {
        socketPath: dockerSocketPath,
        path: requestPath,
        method,
      },
      (res) => {
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
    req.end();
  });
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
    logInfo("Reading mower params", { file: paramsPath });
    const content = await fs.readFile(paramsPath, "utf8");
    const parsed = yaml.load(content);
    const datum = extractGpsDatum(parsed);
    if (!datum) {
      logWarn("Missing datum_lat/datum_long in params file", { file: paramsPath });
      return res.status(422).json({
        error: "datum_lat/datum_long not found in mower_params.yaml",
      });
    }
    logInfo("Loaded mower params datum", datum);
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

app.get("/api/map", async (_req, res) => {
  try {
    logInfo("Reading active map file", { file: mapPath });
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
    logInfo("Listing map backups", { directory: mapDirectory });
    const entries = await fs.readdir(mapDirectory, { withFileTypes: true });
    const mapFiles = entries
      .filter((entry) => entry.isFile() && isValidMapFileName(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => {
        if (a === "map.json") return -1;
        if (b === "map.json") return 1;
        return b.localeCompare(a);
      });
    logInfo("Listed map files", { count: mapFiles.length });
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
    logInfo("Reading map/backup file", { file: backupPath });
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

app.listen(port, () => {
  logInfo("OpenMower Map Editor listening", {
    port,
    mapPath,
    paramsPath,
    restartContainerName,
    dockerSocketPath,
  });
});

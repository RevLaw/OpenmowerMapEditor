const express = require("express");
const fs = require("fs/promises");
const http = require("http");
const yaml = require("js-yaml");

const app = express();
const port = process.env.PORT || 80;

const paramsPath = "/data/params/mower_params.yaml";
const mapPath = "/data/ros/map.json";
const dockerSocketPath = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
const restartContainerName = process.env.OPENMOWER_CONTAINER_NAME || "open_mower_ros";

app.use(express.json({ limit: "20mb" }));
app.use(express.static(__dirname));

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

function dockerApiRequest(method, requestPath) {
  return new Promise((resolve, reject) => {
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
  const inspect = await dockerApiRequest(
    "GET",
    `/containers/${encodeURIComponent(restartContainerName)}/json`
  );
  if (inspect.statusCode === 404) {
    return {
      restarted: false,
      reason: `Container '${restartContainerName}' not found`,
    };
  }
  if (inspect.statusCode < 200 || inspect.statusCode >= 300) {
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
    return {
      restarted: false,
      reason: `Docker restart failed with status ${restart.statusCode}`,
    };
  }

  return { restarted: true };
}

app.get("/api/params", async (_req, res) => {
  try {
    const content = await fs.readFile(paramsPath, "utf8");
    const parsed = yaml.load(content);
    const datum = extractGpsDatum(parsed);
    if (!datum) {
      return res.status(422).json({
        error: "datum_lat/datum_long not found in mower_params.yaml",
      });
    }
    return res.json(datum);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({ error: "mower_params.yaml not found" });
    }
    return res.status(500).json({ error: "Failed to read mower params" });
  }
});

app.get("/api/map", async (_req, res) => {
  try {
    const content = await fs.readFile(mapPath, "utf8");
    return res.type("application/json").send(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({ error: "map.json not found" });
    }
    return res.status(500).json({ error: "Failed to read map.json" });
  }
});

app.post("/api/map", async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ error: "Invalid map payload" });
    }

    const restartRequested = shouldRestartFromQuery(req.query.restart);

    const mapJson = JSON.stringify(req.body, null, 2);
    const backupPath = `${mapPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;

    try {
      await fs.copyFile(mapPath, backupPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    await fs.writeFile(mapPath, mapJson, "utf8");

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
  } catch (_error) {
    return res.status(500).json({ error: "Failed to save map.json" });
  }
});

app.listen(port, () => {
  console.log(`OpenMower Map Editor listening on port ${port}`);
});

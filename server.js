const express = require("express");
const fs = require("fs/promises");
const yaml = require("js-yaml");

const app = express();
const port = process.env.PORT || 80;

const paramsPath = "/data/params/mower_params.yaml";
const mapPath = "/data/ros/map.json";

app.use(express.json({ limit: "20mb" }));
app.use(express.static(__dirname));

function extractGpsDatum(data) {
  const datumLat = data?.ll?.services?.gps?.datum_lat;
  const datumLng = data?.ll?.services?.gps?.datum_long;
  if (!Number.isFinite(datumLat) || !Number.isFinite(datumLng)) {
    return null;
  }
  return { datumLat, datumLng };
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
    return res.json({ ok: true, backupPath });
  } catch (_error) {
    return res.status(500).json({ error: "Failed to save map.json" });
  }
});

app.listen(port, () => {
  console.log(`OpenMower Map Editor listening on port ${port}`);
});

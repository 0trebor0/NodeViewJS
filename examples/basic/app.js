"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { App } = require("../../runtime");

const app = new App({
  title: "NodeViewJS Media Loader",
  appId: "nodeviewjs-demo",
  width: 900,
  height: 700,
  devtools: process.env.NODEVIEW_DEVTOOLS === "1",
  entry: path.join(__dirname, "index.html")
});

const USER_HOME = os.homedir();

const MEDIA_FOLDERS = {
  pictures: path.join(USER_HOME, "Pictures"),
  videos: path.join(USER_HOME, "Videos"),
  music: path.join(USER_HOME, "Music"),
  downloads: path.join(USER_HOME, "Downloads")
};

const MEDIA_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",

  ".mp4",
  ".webm",
  ".ogg",
  ".mov",
  ".mkv",
  ".avi",

  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac"
]);

function getMediaType(ext) {
  ext = ext.toLowerCase();

  if ([
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".svg"
  ].includes(ext)) {
    return "image";
  }

  if ([
    ".mp4",
    ".webm",
    ".ogg",
    ".mov",
    ".mkv",
    ".avi"
  ].includes(ext)) {
    return "video";
  }

  if ([
    ".mp3",
    ".wav",
    ".m4a",
    ".aac",
    ".flac"
  ].includes(ext)) {
    return "audio";
  }

  return "unknown";
}

async function scanMediaFolder(folderPath) {
  const media = [];

  async function walk(currentFolder) {
    let items;

    try {
      items = await fs.readdir(currentFolder, {
        withFileTypes: true
      });
    } catch (error) {
      console.warn(`Cannot read folder: ${currentFolder}`, error.message);
      return;
    }

    for (const item of items) {
      const itemPath = path.join(currentFolder, item.name);

      if (item.isDirectory()) {
        await walk(itemPath);
        continue;
      }

      if (!item.isFile()) continue;

      const ext = path.extname(item.name).toLowerCase();

      if (!MEDIA_EXTENSIONS.has(ext)) continue;

      media.push({
        name: item.name,
        path: itemPath,
        folder: path.dirname(itemPath),
        relativePath: path.relative(folderPath, itemPath),
        url: pathToFileURL(itemPath).href,
        type: getMediaType(ext),
        extension: ext
      });
    }
  }

  await walk(folderPath);

  return media;
}

app.command("greet", async (name) => {
  return `Hello ${name || "there"} from NodeViewJS.`;
});

app.command("loadMedia", async ({ folder = "pictures" }) => {
  const folderPath = MEDIA_FOLDERS[folder];

  if (!folderPath) {
    return {
      error: true,
      message: "Invalid media folder.",
      details: `Allowed folders: ${Object.keys(MEDIA_FOLDERS).join(", ")}`
    };
  }

  try {
    const media = await scanMediaFolder(folderPath);

    return {
      error: false,
      folder,
      folderPath,
      count: media.length,
      media
    };
  } catch (error) {
    return {
      error: true,
      message: `Could not load media from ${folderPath}`,
      details: error.message
    };
  }
});

app.run();
app.showNotification({
  title: "My App",
  message: "The application is ready."
});
import { pathToFileURL } from "node:url";

export function nodeStartupError(version = process.versions.node) {
  const major = Number(String(version).replace(/^v/, "").split(".")[0]);
  if (Number.isFinite(major) && major >= 22) return null;
  return `Talk2Build needs Node.js 22 or newer for node:sqlite. This process is Node ${version}.`;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const message = nodeStartupError();
  if (message) {
    console.error(message);
    process.exit(1);
  }
}

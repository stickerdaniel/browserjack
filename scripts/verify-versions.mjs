// Fails when a version reference drifts from package.json. Keeps the plugin
// manifest and the pinned setup-skill install command in lockstep per release.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const escaped = version.replaceAll(".", "\\.");

const failures = [];

const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
if (lock.version !== version || lock.packages?.[""]?.version !== version) {
  failures.push(`package-lock.json has ${lock.version}, expected ${version} (run npm install)`);
}

const plugin = JSON.parse(await readFile(join(root, "plugin/.claude-plugin/plugin.json"), "utf8"));
if (plugin.version !== version) {
  failures.push(`plugin/.claude-plugin/plugin.json has ${plugin.version}, expected ${version}`);
}

const skill = await readFile(join(root, "plugin/skills/setup/SKILL.md"), "utf8");
const pinned = new RegExp(`^npx --yes browserjack@${escaped} setup `, "m");
if (!pinned.test(skill)) {
  failures.push(
    `plugin/skills/setup/SKILL.md does not pin the setup command to browserjack@${version}`,
  );
}

const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
const heading = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m");
if (!heading.test(changelog)) {
  failures.push(`CHANGELOG.md has no dated ## [${version}] section`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`verify:versions: ${failure}`);
  }
  process.exit(1);
}
console.log(`verify:versions ok (${version})`);

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import test from "node:test";

import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = parse(await readFile(join(root, ".github/workflows/release.yml"), "utf8"));
const sourceManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const gate = workflow.jobs["release-gate"].steps.find((step) => step.id === "gate").run;
const mainOnly =
  "github.repository == 'stickerdaniel/browserjack' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'";
const setupNode = "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";
const downloadArtifact = "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c";
const artifactName = "browserjack-${{ github.sha }}";

function normalized(value) {
  return value.replaceAll(/\s+/g, " ").trim();
}

function assertReleaseBoundary(value) {
  assert.deepEqual(Object.keys(value).toSorted(), ["jobs", "name", "on", "permissions"]);
  assert.deepEqual(value.permissions, { contents: "read" });
  assert.deepEqual(value.on.push, { branches: ["main"] });
  assert.ok(value.on.pull_request.paths.includes(".github/workflows/release.yml"));
  assert.ok(Object.hasOwn(value.on, "workflow_dispatch"));
  assert.deepEqual(Object.keys(value.on).toSorted(), ["pull_request", "push", "workflow_dispatch"]);

  const { verify, publish } = value.jobs;
  const releaseGate = value.jobs["release-gate"];
  assert.deepEqual(Object.keys(value.jobs).toSorted(), ["publish", "release-gate", "verify"]);
  assert.deepEqual(verify.permissions, { contents: "read" });
  assert.equal(verify.concurrency, undefined);
  assert.equal(verify.steps[0].with["persist-credentials"], false);
  assert.equal(verify.steps[1].with["node-version"], "24.21.0");
  assert.equal(verify.steps[1].with["package-manager-cache"], false);
  assert.equal(verify.steps[3].env.BROWSERJACK_RELEASE_GATE_TEST, "required");
  assert.equal(
    verify.steps[4].env.BROWSERJACK_ARTIFACT_DIR,
    "${{ runner.temp }}/browserjack-artifact",
  );
  assert.deepEqual(verify.steps[5].with, {
    name: artifactName,
    path: "${{ runner.temp }}/browserjack-artifact/*",
    "if-no-files-found": "error",
    "retention-days": 30,
  });

  assert.equal(releaseGate.needs, "verify");
  assert.equal(normalized(releaseGate.if), mainOnly);
  assert.deepEqual(releaseGate.permissions, { contents: "read" });
  assert.equal(releaseGate.concurrency, undefined);
  assert.equal(releaseGate.steps[0].with["persist-credentials"], false);
  assert.equal(releaseGate.steps[1].with["node-version"], "24.21.0");
  assert.deepEqual(releaseGate.steps[2].with, {
    name: artifactName,
    path: "${{ runner.temp }}/release",
  });
  assert.equal(releaseGate.steps[2].uses, downloadArtifact);
  assert.deepEqual(releaseGate.steps[3].env, { RELEASE_DIR: "${{ runner.temp }}/release" });
  assert.deepEqual(releaseGate.outputs, {
    publish: "${{ steps.gate.outputs.publish }}",
    version: "${{ steps.gate.outputs.version }}",
    sha256: "${{ steps.gate.outputs.sha256 }}",
  });

  assert.deepEqual(Object.keys(publish).toSorted(), [
    "concurrency",
    "environment",
    "if",
    "needs",
    "permissions",
    "runs-on",
    "steps",
    "timeout-minutes",
  ]);
  assert.deepEqual(publish.needs, ["verify", "release-gate"]);
  assert.equal(
    normalized(publish.if),
    `${mainOnly} && needs.release-gate.outputs.publish == 'true'`,
  );
  assert.deepEqual(publish.permissions, { "id-token": "write" });
  assert.deepEqual(publish.environment, {
    name: "npm",
    url: "https://www.npmjs.com/package/browserjack/v/${{ needs.release-gate.outputs.version }}",
  });
  assert.deepEqual(publish.concurrency, {
    group: "browserjack-npm-release",
    "cancel-in-progress": false,
  });
  assert.deepEqual(
    publish.steps.map((step) => step.uses ?? `run: ${step.name}`),
    [
      setupNode,
      "run: Require npm with trusted publishing support",
      downloadArtifact,
      "run: Publish the tested tarball",
    ],
  );
  assert.deepEqual(
    publish.steps.map((step) => Object.keys(step).toSorted()),
    [
      ["uses", "with"],
      ["name", "run"],
      ["uses", "with"],
      ["env", "name", "run"],
    ],
  );
  assert.deepEqual(publish.steps[0].with, {
    "node-version": "24.21.0",
    "registry-url": "https://registry.npmjs.org",
    "package-manager-cache": false,
  });
  assert.deepEqual(publish.steps[2].with, {
    name: artifactName,
    path: "${{ runner.temp }}/release",
  });
  assert.deepEqual(publish.steps[3].env, {
    RELEASE_DIR: "${{ runner.temp }}/release",
    VERSION: "${{ needs.release-gate.outputs.version }}",
    SHA256: "${{ needs.release-gate.outputs.sha256 }}",
  });
  assert.deepEqual(publish.steps[1].run.trim().split("\n"), [
    "set -euo pipefail",
    'npm_version="$(npm --version)"',
    "printf '11.5.1\\n%s\\n' \"$npm_version\" | sort -V -C || {",
    '  echo "::error::npm $npm_version is older than 11.5.1, which trusted publishing requires."',
    "  exit 1",
    "}",
  ]);
  assert.deepEqual(publish.steps[3].run.trim().split("\n"), [
    "set -euo pipefail",
    'tarball="$RELEASE_DIR/browserjack-$VERSION.tgz"',
    '[ "$(sha256sum "$tarball" | cut -d\' \' -f1)" = "$SHA256" ] || {',
    '  echo "::error::$tarball is not the tarball the release gate checked."',
    "  exit 1",
    "}",
    'npm publish "$tarball" --access public --ignore-scripts --registry https://registry.npmjs.org/',
    "{",
    '  echo "Published browserjack@$VERSION"',
    "  echo",
    '  echo "Tarball sha256: \\`$SHA256\\`"',
    '} >> "$GITHUB_STEP_SUMMARY"',
  ]);
  for (const [name, job] of Object.entries(value.jobs)) {
    if (name !== "publish") {
      assert.ok(!Object.hasOwn(job.permissions ?? {}, "id-token"));
      assert.ok(job.steps.every((step) => !/\bnpm\s+publish\b/.test(step.run ?? "")));
    }
    assert.ok(
      job.steps.every((step) => step.shell === undefined && step.continue_on_error === undefined),
    );
  }
  assert.equal(JSON.stringify(value).includes("write-all"), false);
}

test("release workflow confines publishing credentials and the tested artifact", () => {
  assertReleaseBoundary(workflow);
});

test("release boundary rejects credential and artifact wiring changes", () => {
  for (const mutate of [
    (v) => {
      v.jobs.publish.steps[3].run = v.jobs.publish.steps[3].run.replace("--ignore-scripts", "");
    },
    (v) => {
      v.jobs.publish.steps[2].with.name = "another-artifact";
    },
    (v) => {
      v.jobs.publish.steps[3].env.SHA256 = "abc";
    },
    (v) => {
      v.jobs.verify.permissions["id-token"] = "write";
    },
    (v) => {
      v.jobs.publish.steps[3].shell = "node";
    },
    (v) => {
      v.jobs.publish.steps.unshift({ uses: "actions/checkout@main" });
    },
    (v) => {
      v.jobs.publish.if += " || true";
    },
    (v) => {
      v.on.push.tags = ["v*"];
    },
  ]) {
    const changed = structuredClone(workflow);
    mutate(changed);
    assert.throws(() => assertReleaseBoundary(changed));
  }
});

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const npmVersion = spawnSync(npmBin, ["--version"], { encoding: "utf8" });
const supportsGate = npmVersion.status === 0 && Number.parseInt(npmVersion.stdout, 10) >= 11;
if (!supportsGate && process.env.BROWSERJACK_RELEASE_GATE_TEST === "required") {
  test("release gate requires npm 11 when publishing is enabled", () => {
    assert.fail(
      `npm 11 is required for gate tests (got ${npmVersion.stdout.trim() || npmVersion.stderr.trim()})`,
    );
  });
}

const require = createRequire(import.meta.url);
const tar = supportsGate
  ? require(
      join(
        spawnSync(npmBin, ["root", "-g"], { encoding: "utf8" }).stdout.trim(),
        "npm/node_modules/tar",
      ),
    )
  : undefined;
const requiredEntries = [
  "package/package.json",
  "package/LICENSE",
  "package/dist/cli.js",
  "package/compatibility/manifest.json",
];

async function runGate({
  manifest = sourceManifest,
  members = requiredEntries,
  view = { status: 1, body: '{"error":{"code":"E404"}}' },
  checksum = true,
  archive,
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "browserjack-gate-"));
  try {
    const releaseDir = join(dir, "release");
    const stage = join(dir, "stage");
    const bin = join(dir, "bin");
    await mkdir(releaseDir);
    await mkdir(bin);
    for (const name of requiredEntries) {
      const path = join(stage, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        name === "package/package.json" ? JSON.stringify(manifest) : `${name}\n`,
      );
    }
    for (const name of members.filter((entry) => !requiredEntries.includes(entry))) {
      const path = join(stage, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${name}\n`);
    }
    await writeFile(join(dir, "package.json"), JSON.stringify(sourceManifest));
    const tarball = join(releaseDir, `browserjack-${sourceManifest.version}.tgz`);
    if (archive) {
      await writeFile(tarball, archive);
    } else {
      await tar.c({ file: tarball, gzip: true, cwd: stage, portable: true }, members);
    }
    const digest = createHash("sha256")
      .update(await readFile(tarball))
      .digest("hex");
    await writeFile(`${tarball}.sha256`, `${checksum ? digest : "0".repeat(64)}  ${tarball}\n`);
    const realNpm = spawnSync("/bin/sh", ["-c", "command -v npm"], {
      encoding: "utf8",
    }).stdout.trim();
    await writeFile(
      join(bin, "npm"),
      `#!/bin/sh\nif [ "$1" = view ]; then printf '%s\\n' "$NPM_VIEW_BODY"; exit "$NPM_VIEW_STATUS"; fi\nexec '${realNpm}' "$@"\n`,
    );
    await chmod(join(bin, "npm"), 0o755);
    const script = join(dir, "gate.sh");
    await writeFile(script, gate);
    const output = join(dir, "output");
    await writeFile(output, "");
    const result = spawnSync("/bin/bash", [script], {
      cwd: dir,
      env: {
        ...process.env,
        HOME: dir,
        PATH: `${bin}:${process.env.PATH}`,
        RELEASE_DIR: releaseDir,
        RUNNER_TEMP: dir,
        GITHUB_OUTPUT: output,
        NPM_VIEW_BODY: view.body,
        NPM_VIEW_STATUS: String(view.status),
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    return { ...result, output: await readFile(output, "utf8"), digest };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const gateTest = supportsGate ? test : test.skip;
gateTest("release gate authorizes only an explicit npm E404", async () => {
  const absent = await runGate();
  assert.equal(absent.status, 0, absent.stdout + absent.stderr);
  assert.equal(
    absent.output,
    `publish=true\nversion=${sourceManifest.version}\nsha256=${absent.digest}\n`,
  );
  const present = await runGate({
    view: { status: 0, body: JSON.stringify(sourceManifest.version) },
  });
  assert.equal(present.status, 0, present.stdout + present.stderr);
  assert.match(present.output, /publish=false/);
  for (const view of [
    { status: 0, body: "" },
    { status: 0, body: "not json" },
    { status: 0, body: '"0.0.0"' },
    { status: 1, body: '{"error":{"code":"E500"}}' },
    { status: 1, body: "" },
  ]) {
    const result = await runGate({ view });
    assert.notEqual(result.status, 0, `view ${JSON.stringify(view)} was accepted`);
    assert.equal(result.output, "");
  }
});

gateTest("release gate rejects manifest, archive and hash mismatches", async () => {
  for (const args of [
    { manifest: { ...sourceManifest, name: "other" } },
    { manifest: { ...sourceManifest, version: "9.9.9" } },
    { manifest: { ...sourceManifest, publishConfig: { access: "public" } } },
    {
      manifest: {
        ...sourceManifest,
        publishConfig: { ...sourceManifest.publishConfig, registry: "https://example.test" },
      },
    },
    { members: [...requiredEntries, "shadow/package.json"] },
    { checksum: false },
  ]) {
    const result = await runGate(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.equal(result.output, "");
  }
});

function ustarArchive(members) {
  const blocks = members.flatMap(
    ({ name, data = "", type = "0", linkname = "", badChecksum = false }) => {
      const content = Buffer.from(data);
      const header = Buffer.alloc(512);
      const field = (value, start) => header.write(value, start, "latin1");
      const number = (value, start, length) =>
        field(`${value.toString(8).padStart(length - 1, "0")}\0`, start);
      field(name, 0);
      number(0o644, 100, 8);
      number(0, 108, 8);
      number(0, 116, 8);
      number(type === "0" ? content.length : 0, 124, 12);
      number(0, 136, 12);
      field(" ".repeat(8), 148);
      field(type, 156);
      field(linkname, 157);
      field("ustar\0", 257);
      field("00", 263);
      field(
        badChecksum
          ? "garbled!"
          : `${header
              .reduce((sum, byte) => sum + byte, 0)
              .toString(8)
              .padStart(6, "0")}\0 `,
        148,
      );
      if (type !== "0") return [header];
      const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
      content.copy(padded);
      return [header, padded];
    },
  );
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

function packedMembers() {
  return requiredEntries.map((name) => ({
    name,
    data: name === "package/package.json" ? JSON.stringify(sourceManifest) : `${name}\n`,
  }));
}

gateTest("release gate rejects nonregular, duplicate and malformed entries", async () => {
  for (const members of [
    [...packedMembers(), { name: "package/dist/cli.js", data: "duplicate" }],
    [...packedMembers(), { name: "package/./extra", data: "dot path" }],
    [...packedMembers(), { name: "package/link", type: "2", linkname: "package.json" }],
    [{ name: "package/dist/notes", data: "bad", badChecksum: true }, ...packedMembers()],
  ]) {
    const result = await runGate({ archive: ustarArchive(members) });
    assert.notEqual(result.status, 0, JSON.stringify(members.map((m) => m.name)));
    assert.equal(result.output, "");
  }
});

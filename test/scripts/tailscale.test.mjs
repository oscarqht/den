import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import nextConfig from "../../next.config.mjs";
import { runStart, runStop } from "../../scripts/tailscale.mjs";

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function createTempStatePath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "palx-tailscale-test-"));
  tempDirs.push(tempDir);
  return path.join(tempDir, "tailscale-state.json");
}

function createRunner(statusSequence) {
  const calls = [];
  const queue = [...statusSequence];

  return {
    calls,
    run(command, args, options = {}) {
      calls.push({ command, args, options });
      const next = queue.shift();
      if (!next) {
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
      if (typeof next === "function") {
        return next(command, args, options);
      }
      return next;
    },
  };
}

describe("runStart", () => {
  it("fails when tailscale is unavailable", async () => {
    await assert.rejects(
      runStart({
        statePath: createTempStatePath(),
        commandExists: () => false,
        checkLocalPort: async () => true,
        runCommand: () => ({ status: 0, stdout: "" }),
      }),
      /tailscale CLI is not installed/,
    );
  });

  it("fails when Palx is not listening on 127.0.0.1:3200", async () => {
    await assert.rejects(
      runStart({
        statePath: createTempStatePath(),
        commandExists: () => true,
        checkLocalPort: async () => false,
        runCommand: () => ({ status: 0, stdout: "" }),
      }),
      /127.0.0.1:3200 is not reachable/,
    );
  });

  it("shows the Tailscale login URL when authentication is required", async () => {
    const runner = createRunner([
      {
        status: 0,
        stdout: JSON.stringify({ BackendState: "NeedsLogin" }),
      },
      {
        status: 0,
        stdout: JSON.stringify({
          BackendState: "NeedsLogin",
          AuthURL: "https://login.tailscale.com/a/example-auth",
        }),
      },
    ]);
    const statePath = createTempStatePath();

    await assert.rejects(
      runStart({
        statePath,
        commandExists: () => true,
        checkLocalPort: async () => true,
        runCommand: runner.run,
      }),
      /https:\/\/login\.tailscale\.com\/a\/example-auth/,
    );

    assert.strictEqual(runner.calls.length, 2);
    assert.deepStrictEqual(runner.calls[0].args, ["status", "--json"]);
    assert.deepStrictEqual(runner.calls[1].args, ["up", "--json"]);
    assert.strictEqual(fs.existsSync(statePath), false);
  });

  it("stores that it owns the connection when tailscale up succeeds immediately", async () => {
    const runner = createRunner([
      {
        status: 0,
        stdout: JSON.stringify({ BackendState: "NeedsLogin" }),
      },
      {
        status: 0,
        stdout: JSON.stringify({ BackendState: "Running" }),
      },
      {
        status: 0,
        stdout: JSON.stringify({
          BackendState: "Running",
          Self: {
            DNSName: "palx-node.tailnet.ts.net.",
            TailscaleIPs: ["100.101.102.103"],
          },
        }),
      },
      { status: 0, stdout: "" },
    ]);
    const statePath = createTempStatePath();

    const result = await runStart({
      statePath,
      commandExists: () => true,
      checkLocalPort: async () => true,
      runCommand: runner.run,
    });

    assert.strictEqual(runner.calls.length, 4);
    assert.deepStrictEqual(runner.calls[0].args, ["status", "--json"]);
    assert.deepStrictEqual(runner.calls[1].args, ["up", "--json"]);
    assert.deepStrictEqual(runner.calls[2].args, ["status", "--json"]);
    assert.deepStrictEqual(
      runner.calls[3].args,
      ["serve", "--bg", "--http=3200", "http://127.0.0.1:3200"],
    );
    assert.deepStrictEqual(result.urls, [
      "http://palx-node.tailnet.ts.net:3200",
      "http://100.101.102.103:3200",
    ]);
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(statePath, "utf8")),
      { ownsConnection: true, port: 3200 },
    );
  });

  it("reuses an existing tailscale connection without calling tailscale up", async () => {
    const runner = createRunner([
      {
        status: 0,
        stdout: JSON.stringify({
          BackendState: "Running",
          Self: {
            DNSName: "palx-node.tailnet.ts.net.",
            TailscaleIPs: ["100.101.102.103"],
          },
        }),
      },
      { status: 0, stdout: "" },
    ]);
    const statePath = createTempStatePath();

    const result = await runStart({
      statePath,
      commandExists: () => true,
      checkLocalPort: async () => true,
      runCommand: runner.run,
    });

    assert.strictEqual(runner.calls.length, 2);
    assert.deepStrictEqual(runner.calls[1].args, [
      "serve",
      "--bg",
      "--http=3200",
      "http://127.0.0.1:3200",
    ]);
    assert.strictEqual(result.ownsConnection, false);
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(statePath, "utf8")),
      { ownsConnection: false, port: 3200 },
    );
  });
});

describe("runStop", () => {
  it("removes the serve mapping and disconnects when the start flow brought tailscale up", async () => {
    const statePath = createTempStatePath();
    fs.writeFileSync(statePath, JSON.stringify({ ownsConnection: true, port: 3200 }));
    const runner = createRunner([
      { status: 0, stdout: "" },
      { status: 0, stdout: "" },
    ]);

    const result = await runStop({
      statePath,
      commandExists: () => true,
      runCommand: runner.run,
    });

    assert.deepStrictEqual(runner.calls.map((call) => call.args), [
      ["serve", "reset"],
      ["down"],
    ]);
    assert.strictEqual(result.disconnected, true);
    assert.strictEqual(fs.existsSync(statePath), false);
  });

  it("skips tailscale down when the connection already existed", async () => {
    const statePath = createTempStatePath();
    fs.writeFileSync(statePath, JSON.stringify({ ownsConnection: false, port: 3200 }));
    const runner = createRunner([{ status: 0, stdout: "" }]);

    const result = await runStop({
      statePath,
      commandExists: () => true,
      runCommand: runner.run,
    });

    assert.deepStrictEqual(runner.calls.map((call) => call.args), [["serve", "reset"]]);
    assert.strictEqual(result.disconnected, false);
    assert.strictEqual(fs.existsSync(statePath), false);
  });
});

describe("nextConfig", () => {
  it("allows Tailscale MagicDNS hosts during development", () => {
    assert.ok(nextConfig.allowedDevOrigins.includes("*.ts.net"));
    assert.ok(nextConfig.experimental.serverActions.allowedOrigins.includes("*.ts.net"));
  });

  it("allows Tailscale CGNAT IP hosts during development", () => {
    assert.ok(nextConfig.allowedDevOrigins.includes("100.*"));
    assert.ok(nextConfig.experimental.serverActions.allowedOrigins.includes("100.*"));
  });
});

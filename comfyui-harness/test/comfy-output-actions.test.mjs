import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildWindowsExplorerSelectArgs,
  classifyExplorerLaunchError,
  explorerExecutable,
  launchWindowsExplorer,
  showComfyOutputInFolder,
  ComfyOutputPathError
} from "../lib/comfy-output-actions.mjs";
import { openArchiveFolder } from "../lib/archive-folder-picker.mjs";

function historyOk(promptId, filename) {
  return {
    ok: true,
    json: async () => ({
      [promptId]: {
        outputs: {
          "1": { videos: [{ filename, subfolder: "", type: "output" }] }
        }
      }
    })
  };
}

test("explorer executable is explorer.exe on Windows only", () => {
  assert.equal(explorerExecutable("win32"), "explorer.exe");
  assert.equal(explorerExecutable("linux"), null);
  assert.equal(explorerExecutable("darwin"), null);
});

test("select arguments are a single /select,<absolutePath> argv", () => {
  const filePath = path.join("C:", "ComfyUI", "output", "video", "clip.mp4");
  const abs = path.resolve(filePath);
  const args = buildWindowsExplorerSelectArgs(abs);
  assert.equal(args.length, 1);
  assert.equal(args[0], `/select,${abs}`);
  assert.equal(args[0].startsWith("/select,"), true);
  assert.throws(() => buildWindowsExplorerSelectArgs(""), ComfyOutputPathError);
  assert.throws(() => buildWindowsExplorerSelectArgs("relative\\clip.mp4"), ComfyOutputPathError);
});

test("successful launch returns ok and uses select argv", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "h3-show-ok-"));
  writeFileSync(path.join(dir, "clip.mp4"), Buffer.from("abc"));
  const calls = [];
  const result = await showComfyOutputInFolder({
    outputRoot: dir,
    comfyUrl: "http://127.0.0.1:9",
    promptId: "pid-ok",
    filename: "clip.mp4",
    platform: "win32",
    fetchFn: async () => historyOk("pid-ok", "clip.mp4"),
    execFileImpl: async (exe, args) => {
      calls.push({ exe, args });
    }
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].exe, "explorer.exe");
  assert.deepEqual(calls[0].args, buildWindowsExplorerSelectArgs(path.join(dir, "clip.mp4")));
});

test("generic execFile failure is NOT swallowed as ok:true", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "h3-show-fail-"));
  writeFileSync(path.join(dir, "clip.mp4"), Buffer.from("abc"));
  await assert.rejects(
    () => showComfyOutputInFolder({
      outputRoot: dir,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "pid-fail",
      filename: "clip.mp4",
      platform: "win32",
      fetchFn: async () => historyOk("pid-fail", "clip.mp4"),
      execFileImpl: async () => {
        throw new Error("boom-generic");
      }
    }),
    err => err instanceof ComfyOutputPathError
      && err.code === "explorer-failed"
      && /boom-generic/.test(err.message)
  );
});

test("non-zero Explorer exit is reported (no false ok:true)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "h3-show-exit-"));
  writeFileSync(path.join(dir, "clip.mp4"), Buffer.from("abc"));
  await assert.rejects(
    () => showComfyOutputInFolder({
      outputRoot: dir,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "pid-exit",
      filename: "clip.mp4",
      platform: "win32",
      fetchFn: async () => historyOk("pid-exit", "clip.mp4"),
      execFileImpl: async () => {
        const error = new Error("Command failed: explorer.exe");
        error.code = 1;
        throw error;
      }
    }),
    err => err instanceof ComfyOutputPathError && err.code === "explorer-exit"
  );
});

test("timeout is reported", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "h3-show-timeout-"));
  writeFileSync(path.join(dir, "clip.mp4"), Buffer.from("abc"));
  await assert.rejects(
    () => showComfyOutputInFolder({
      outputRoot: dir,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "pid-timeout",
      filename: "clip.mp4",
      platform: "win32",
      fetchFn: async () => historyOk("pid-timeout", "clip.mp4"),
      execFileImpl: async () => {
        const error = new Error("timeout");
        error.code = "ETIMEDOUT";
        error.killed = true;
        throw error;
      }
    }),
    err => err instanceof ComfyOutputPathError && err.code === "explorer-timeout"
  );
});

test("ENOENT and EACCES are reported", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "h3-show-enoent-"));
  writeFileSync(path.join(dir, "clip.mp4"), Buffer.from("abc"));
  await assert.rejects(
    () => showComfyOutputInFolder({
      outputRoot: dir,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "pid-enoent",
      filename: "clip.mp4",
      platform: "win32",
      fetchFn: async () => historyOk("pid-enoent", "clip.mp4"),
      execFileImpl: async () => {
        const error = new Error("not found");
        error.code = "ENOENT";
        throw error;
      }
    }),
    err => err instanceof ComfyOutputPathError && err.code === "explorer-enoent"
  );
  await assert.rejects(
    () => showComfyOutputInFolder({
      outputRoot: dir,
      comfyUrl: "http://127.0.0.1:9",
      promptId: "pid-eacces",
      filename: "clip.mp4",
      platform: "win32",
      fetchFn: async () => historyOk("pid-eacces", "clip.mp4"),
      execFileImpl: async () => {
        const error = new Error("denied");
        error.code = "EACCES";
        throw error;
      }
    }),
    err => err instanceof ComfyOutputPathError && err.code === "explorer-eacces"
  );
});

test("classifyExplorerLaunchError covers common failure shapes", () => {
  assert.equal(classifyExplorerLaunchError({ code: "ENOENT" }).code, "explorer-enoent");
  assert.equal(classifyExplorerLaunchError({ code: "EACCES" }).code, "explorer-eacces");
  assert.equal(classifyExplorerLaunchError({ code: "ETIMEDOUT", killed: true }).code, "explorer-timeout");
  assert.equal(classifyExplorerLaunchError({ code: 2 }).code, "explorer-exit");
  assert.equal(classifyExplorerLaunchError(new Error("x")).code, "explorer-failed");
});

test("Apri cartella opens directory without /select; failures are not swallowed", async () => {
  const calls = [];
  const dir = path.resolve(mkdtempSync(path.join(tmpdir(), "h3-archive-open-")));
  const result = await openArchiveFolder({
    absolutePath: dir,
    platform: "win32",
    execFileImpl: async (exe, args) => {
      calls.push({ exe, args });
    }
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].exe, "explorer.exe");
  assert.deepEqual(calls[0].args, [dir]);
  assert.equal(String(calls[0].args[0]).startsWith("/select,"), false);

  await assert.rejects(
    () => openArchiveFolder({
      absolutePath: dir,
      platform: "win32",
      execFileImpl: async () => {
        throw new Error("open-failed");
      }
    }),
    err => err instanceof ComfyOutputPathError && err.code === "explorer-failed"
  );
});

test("openArchiveFolder rejects missing/blank paths before path.resolve cwd fallback", async () => {
  for (const value of [undefined, null, "", "   ", "\t"]) {
    let launched = false;
    await assert.rejects(
      () => openArchiveFolder({
        absolutePath: value,
        platform: "win32",
        execFileImpl: async () => {
          launched = true;
        }
      }),
      err => err instanceof ComfyOutputPathError
        && err.code === "archive-unconfigured"
        && launched === false
    );
  }
});

function mockChildProcess() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.kill = () => {};
  child.unref = () => { child.unrefCalled = true; };
  return child;
}

test("launchWindowsExplorer rejects when async error arrives before spawn", async () => {
  const child = mockChildProcess();
  const promise = launchWindowsExplorer(["/select,C:\\tmp\\clip.mp4"], {
    spawnImpl: () => child,
    timeoutMs: 2000
  });
  queueMicrotask(() => {
    child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
  });
  await assert.rejects(
    () => promise,
    err => err instanceof ComfyOutputPathError && err.code === "explorer-enoent"
  );
});

test("launchWindowsExplorer resolves only after asynchronous spawn", async () => {
  const child = mockChildProcess();
  const promise = launchWindowsExplorer(["C:\\tmp\\archive"], {
    spawnImpl: () => child,
    timeoutMs: 2000
  });
  let resolved = false;
  promise.then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false);
  queueMicrotask(() => {
    child.emit("spawn");
  });
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(result.pid, 4242);
  assert.equal(child.unrefCalled, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyHistoryState,
  historyFailureLabel,
  isPromptComplete,
  promptIdPrefix
} from "../public/recovery.mjs";

const promptId = "prompt-456";

const successHistory = {
  [promptId]: {
    status: {
      status_str: "success",
      completed: true,
      messages: [
        ["execution_start", { prompt_id: promptId, timestamp: 1 }],
        ["execution_success", { prompt_id: promptId, timestamp: 2 }]
      ]
    },
    outputs: { "92": { videos: [{ filename: "x.mp4" }] } }
  }
};

const errorHistory = {
  [promptId]: {
    status: {
      status_str: "error",
      completed: false,
      messages: [
        ["execution_start", { prompt_id: promptId, timestamp: 1 }],
        ["execution_error", { prompt_id: promptId, node_id: "5", exception_message: "CUDA out of memory" }]
      ]
    },
    outputs: {}
  }
};

const interruptedHistory = {
  [promptId]: {
    status: {
      status_str: "error",
      completed: false,
      messages: [
        ["execution_start", { prompt_id: promptId, timestamp: 1 }],
        ["execution_interrupted", { prompt_id: promptId, node_id: "5" }]
      ]
    },
    outputs: {}
  }
};

test("isPromptComplete detects finished history entries", () => {
  assert.equal(isPromptComplete({}, promptId), false);
  assert.equal(isPromptComplete({ [promptId]: {} }, promptId), false);
  assert.equal(isPromptComplete({ [promptId]: { outputs: {} } }, promptId), false);
  assert.equal(isPromptComplete(successHistory, promptId), true);
});

test("classifyHistoryState matches ComfyUI terminal history states", () => {
  assert.equal(classifyHistoryState({}, promptId), "unknown");
  assert.equal(classifyHistoryState(successHistory, promptId), "completed");
  assert.equal(classifyHistoryState(errorHistory, promptId), "failed");
  assert.equal(classifyHistoryState(interruptedHistory, promptId), "failed");
  assert.equal(classifyHistoryState({
    [promptId]: {
      status: { status_str: "success", completed: false, messages: [["execution_start", {}]] },
      outputs: {}
    }
  }, promptId), "unknown");
});

test("historyFailureLabel distinguishes error and interruption", () => {
  assert.equal(historyFailureLabel(errorHistory, promptId), "failed");
  assert.equal(historyFailureLabel(interruptedHistory, promptId), "interrupted");
});

test("promptIdPrefix returns a short stable prefix", () => {
  assert.equal(promptIdPrefix("abcdef123456"), "abcdef12");
  assert.equal(promptIdPrefix(""), "");
});

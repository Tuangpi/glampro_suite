import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";

/** Chrome's local debugging pipe: no browser automation dependency or TCP debugger. */
export class Browser {
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  private buffer = "";
  private sessionId = "";
  readonly process: ChildProcess;

  constructor(directory: string) {
    this.process = spawn(
      process.env.CP003_CHROME ?? "/usr/bin/google-chrome",
      [
        "--headless=new",
        "--remote-debugging-pipe",
        "--no-first-run",
        `--user-data-dir=${directory}`,
      ],
      { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
    );
    (this.process.stdio[4] as Readable).setEncoding("utf8").on("data", (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while ((end = this.buffer.indexOf("\0")) >= 0) {
        const message = JSON.parse(this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end + 1);
        const request = this.pending.get(message.id);
        if (!request) continue;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result ?? {});
      }
    });
    const fail = () => {
      for (const request of this.pending.values()) request.reject(new Error("Chrome exited"));
      this.pending.clear();
    };
    this.process.on("exit", fail);
    this.process.on("error", fail);
  }

  async send(method: string, params: object = {}, browser = false) {
    const id = ++this.nextId;
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    const timer = setTimeout(() => {
      this.pending.get(id)?.reject(new Error(`Chrome command timed out: ${method}`));
      this.pending.delete(id);
    }, 15_000);
    try {
      (this.process.stdio[3] as Writable).write(
        `${JSON.stringify({ id, method, params, ...(!browser && this.sessionId ? { sessionId: this.sessionId } : {}) })}\0`,
      );
      return await result;
    } finally {
      clearTimeout(timer);
    }
  }

  async start() {
    const target = await this.send("Target.createTarget", { url: "about:blank" }, true);
    const attached = await this.send(
      "Target.attachToTarget",
      { targetId: target.targetId, flatten: true },
      true,
    );
    this.sessionId = String(attached.sessionId);
    await this.send("Page.enable");
    await this.send("Network.enable");
  }

  async evaluate(expression: string): Promise<unknown> {
    const response = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    assert.equal(response.exceptionDetails, undefined, "Browser expression failed");
    return (response.result as { value?: unknown }).value;
  }

  async wait(expression: string) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Deliberately omit page HTML/storage: they could contain session material.
    throw new Error(`Browser condition timed out: ${expression}`);
  }
}

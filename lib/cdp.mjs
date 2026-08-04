export class CdpClient {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
  }

  async connect() {
    this.#socket = new WebSocket(this.webSocketUrl);
    this.#socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        for (const listener of this.#listeners.get(message.method) || []) {
          listener(message.params ?? {});
        }
        return;
      }
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result ?? {});
    });
    this.#socket.addEventListener("close", () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error("CDP connection closed"));
      }
      this.#pending.clear();
    });
    await new Promise((resolve, reject) => {
      this.#socket.addEventListener("open", resolve, { once: true });
      this.#socket.addEventListener("error", reject, { once: true });
    });
    return this;
  }

  send(method, params = {}) {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP connection is not open"));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.#listeners.get(method) || new Set();
    listeners.add(listener);
    this.#listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  waitFor(method, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      let timer;
      const unsubscribe = this.on(method, (params) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(params);
      });
      timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
    });
  }

  close() {
    this.#listeners.clear();
    this.#socket?.close();
  }
}

export async function listPageTargets(port = 47824) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
  const targets = await response.json();
  return targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
}

export function selectMainCodexTarget(targets) {
  return targets.find((target) => target.url === "app://-/index.html")
    ?? targets.find((target) => target.url?.startsWith("app://-/index.html")
      && !target.url.includes("avatar-overlay"))
    ?? targets[0]
    ?? null;
}

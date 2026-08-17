function escapeInlineScript(source) {
  return String(source).replace(/<\/script/gi, "<\\/script");
}

function escapeInlineStyle(source) {
  return String(source).replace(/<\/style/gi, "<\\/style");
}

export function createEmbeddedPanelDocument({
  html,
  styles,
  appSource,
  promptBuilderSource,
  issueViewsSource,
  panelUrl
}) {
  const stylesheetPattern = /<link\s+[^>]*href=["']\/styles\.css["'][^>]*>/i;
  const applicationScriptPattern = /<script\s+[^>]*src=["']\/app\.js["'][^>]*><\/script>/i;
  if (!stylesheetPattern.test(html) || !applicationScriptPattern.test(html)) {
    throw new Error("Panel HTML is missing the expected stylesheet or application script tag.");
  }

  const promptScript = String(promptBuilderSource)
    .replace(/\bexport\s+(?=(?:const|function|class)\b)/g, "");
  const issueViewsScript = String(issueViewsSource || "")
    .replace(/\bexport\s+(?=(?:const|function|class)\b)/g, "");
  const applicationScript = String(appSource)
    .replace(/^\s*import\s+\{[\s\S]*?\}\s+from\s+["']\/prompt-builder\.js["'];\s*/m, "")
    .replace(/^\s*import\s+\{[\s\S]*?\}\s+from\s+["']\/issue-views\.js["'];\s*/m, "");
  const bridgeBootstrap = `
window.__JIRA_WORKBENCH_EMBEDDED__ = true;
const PANEL_BASE_URL = ${JSON.stringify(panelUrl)};

window.fetch = async (input, init = {}) => {
  const sourceRequest = input instanceof Request ? input : null;
  const inputUrl = sourceRequest ? sourceRequest.url : String(input);
  const headers = new Headers(sourceRequest?.headers || undefined);
  new Headers(init.headers || undefined).forEach((value, name) => headers.set(name, value));
  const method = String(init.method || sourceRequest?.method || "GET").toUpperCase();
  let body = init.body;
  if (body == null && sourceRequest && !["GET", "HEAD"].includes(method)) {
    body = await sourceRequest.clone().text();
  }
  if (body != null && typeof body !== "string") body = String(body);
  const payload = await window.parent.__jiraWorkbenchHostFetch({
    url: new URL(inputUrl, PANEL_BASE_URL).href,
    method,
    headers: Object.fromEntries(headers.entries()),
    body: body ?? null
  });
  const bytes = payload.bodyBase64
    ? Uint8Array.from(atob(payload.bodyBase64), (character) => character.charCodeAt(0))
    : null;
  return new Response(bytes, {
    status: payload.status,
    statusText: payload.statusText,
    headers: payload.headers
  });
};

window.__jiraWorkbenchAssetUrl = async (url) => {
  const response = await window.fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("Asset decode failed")), { once: true });
    reader.readAsDataURL(blob);
  });
};`;

  return String(html)
    .replace(stylesheetPattern, `<style>${escapeInlineStyle(styles)}</style>`)
    .replace(
      applicationScriptPattern,
      `<script>${escapeInlineScript(bridgeBootstrap)}</script>`
      + `<script>${escapeInlineScript(`${promptScript}\n${issueViewsScript}\n${applicationScript}`)}</script>`
    );
}

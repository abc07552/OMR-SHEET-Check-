/** A school server is one explicit HTTPS origin, never an API path or token URL. */
export function normalizeServerOrigin(input: string): string {
  const value = input.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter your school server’s complete HTTPS address.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const authority = /^https:\/\/([^/?#]+)\/?$/i.exec(value)?.[1] || "";
  const rawHost = authority
    .replace(/:\d*$/, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (
    value.length > 2048 ||
    /[\u0000-\u001f\u007f-\uffff]/.test(input) ||
    /[\u0000-\u0020\u007f-\uffff]/.test(value) ||
    /[\\%@]/.test(value) ||
    !authority ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    value.includes("?") ||
    value.includes("#") ||
    !hostname ||
    hostname.length > 253 ||
    !hostname
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    ["localhost", "0.0.0.0"].includes(hostname) ||
    hostname.startsWith("127.") ||
    hostname.endsWith(".localhost") ||
    (/^[\d.]+$/.test(hostname) &&
      (rawHost !== hostname || hostname.startsWith("0."))) ||
    url.port === "0"
  ) {
    throw new Error(
      "Use an HTTPS server origin only, without credentials, /api, a path, query or fragment. Localhost is this phone, not your server. Use a DNS name (punycode for international names) or a non-loopback IPv4 address.",
    );
  }
  url.hostname = hostname;
  return url.origin;
}

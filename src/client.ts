// undici's fetch, not the global: measured, the global fetch is NOT wired to
// undici's MockAgent dispatcher, so a mocked request reached real eBay even
// with disableNetConnect() on. undici is therefore a runtime dependency.

import { fetch } from "undici";

export interface EbayCreds {
  clientId?: string;
  clientSecret?: string;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

export class EbayTokenClient {
  private token: CachedToken | null = null;

  constructor(private readonly creds: EbayCreds) {}

  isConfigured(): boolean {
    return Boolean(this.creds.clientId && this.creds.clientSecret);
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64");
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
      redirect: "error",
    });
    if (!res.ok) throw new Error(`eBay token HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 64_000) throw new Error("eBay token answer is larger than a token");
    const body = JSON.parse(text) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string" || body.access_token.length === 0) throw new Error("eBay token answer has no access_token");
    const expiresIn = typeof body.expires_in === "number" && Number.isFinite(body.expires_in) ? body.expires_in : 300;
    this.token = { value: body.access_token, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
    return this.token.value;
  }
}

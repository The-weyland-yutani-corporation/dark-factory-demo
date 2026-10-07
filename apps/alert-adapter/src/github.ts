import { createSign } from "node:crypto";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import type { NormalizedAlert } from "./types.js";

export interface GitHubDispatcher {
  dispatch(alert: NormalizedAlert): Promise<void>;
}

export interface PrivateKeyProvider {
  getPrivateKey(): Promise<string>;
}

interface GitHubInstallationTokenResponse {
  token?: string;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function createGitHubAppJwt(
  appId: string,
  privateKey: string,
  now: Date = new Date(),
): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - 60;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: appId }),
  );
  const unsignedToken = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(unsignedToken)
    .end()
    .sign(privateKey, "base64url");
  return `${unsignedToken}.${signature}`;
}

export class KeyVaultPrivateKeyProvider implements PrivateKeyProvider {
  public constructor(
    private readonly client: SecretClient,
    private readonly secretName: string,
  ) {}

  public static fromEnvironment(): KeyVaultPrivateKeyProvider {
    const vaultUrl = process.env.KEY_VAULT_URI;
    const secretName =
      process.env.GITHUB_APP_PRIVATE_KEY_SECRET_NAME ??
      "dark-factory-mage-private-key";
    if (!vaultUrl) throw new Error("KEY_VAULT_URI is required.");
    return new KeyVaultPrivateKeyProvider(
      new SecretClient(vaultUrl, new DefaultAzureCredential()),
      secretName,
    );
  }

  public async getPrivateKey(): Promise<string> {
    const secret = await this.client.getSecret(this.secretName);
    if (!secret.value) {
      throw new Error(`Key Vault secret ${this.secretName} has no value.`);
    }
    return secret.value;
  }
}

export class GitHubAppDispatcher implements GitHubDispatcher {
  public constructor(
    private readonly config: {
      appId: string;
      installationId: string;
      owner: string;
      repository: string;
    },
    private readonly privateKeyProvider: PrivateKeyProvider,
    private readonly request: typeof fetch = fetch,
  ) {}

  public static fromEnvironment(): GitHubAppDispatcher {
    return new GitHubAppDispatcher(
      {
        appId: process.env.GITHUB_APP_ID ?? "5122991",
        installationId: process.env.GITHUB_APP_INSTALLATION_ID ?? "168176539",
        owner:
          process.env.GITHUB_REPOSITORY_OWNER ??
          "The-weyland-yutani-corporation",
        repository: process.env.GITHUB_REPOSITORY_NAME ?? "dark-factory-demo",
      },
      KeyVaultPrivateKeyProvider.fromEnvironment(),
    );
  }

  public async dispatch(alert: NormalizedAlert): Promise<void> {
    const privateKey = await this.privateKeyProvider.getPrivateKey();
    const appJwt = createGitHubAppJwt(this.config.appId, privateKey);
    const tokenResponse = await this.request(
      `https://api.github.com/app/installations/${this.config.installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${appJwt}`,
          "User-Agent": "dark-factory-azure-alert-adapter",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!tokenResponse.ok) {
      throw new Error(
        `GitHub installation token request failed with ${tokenResponse.status}.`,
      );
    }
    const tokenBody =
      (await tokenResponse.json()) as GitHubInstallationTokenResponse;
    if (!tokenBody.token) {
      throw new Error(
        "GitHub installation token response did not include a token.",
      );
    }

    const dispatchResponse = await this.request(
      `https://api.github.com/repos/${this.config.owner}/${this.config.repository}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${tokenBody.token}`,
          "Content-Type": "application/json",
          "User-Agent": "dark-factory-azure-alert-adapter",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          event_type: alert.eventType,
          client_payload: alert,
        }),
      },
    );
    if (!dispatchResponse.ok) {
      throw new Error(
        `GitHub repository dispatch failed with ${dispatchResponse.status}.`,
      );
    }
  }
}

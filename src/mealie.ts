export interface MealieBackup {
  name: string;
  date: string;
  size?: number;
}

interface BackupListResponse {
  imports: MealieBackup[];
  templates: string[];
}

export function createMealieClient(baseUrl: string, apiKey: string) {
  const base = baseUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${apiKey}` };

  async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${base}${path}`;
    const method = init?.method ?? "GET";
    console.log(`[mealie] ${method} ${path}`);

    const res = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Mealie ${method} ${path} → ${res.status} ${res.statusText}: ${body}`);
    }

    return res;
  }

  async function createBackup(): Promise<void> {
    await apiFetch("/api/admin/backups", { method: "POST" });
  }

  async function listBackups(): Promise<MealieBackup[]> {
    const res = await apiFetch("/api/admin/backups");
    const data = (await res.json()) as BackupListResponse;
    return data.imports ?? [];
  }

  async function getDownloadToken(filename: string): Promise<string> {
    const res = await apiFetch(
      `/api/admin/backups/${encodeURIComponent(filename)}/download`
    );
    const data = (await res.json()) as { fileToken: string };
    return data.fileToken;
  }

  async function downloadBackup(token: string): Promise<ReadableStream<Uint8Array>> {
    const res = await apiFetch(
      `/api/utils/download?token=${encodeURIComponent(token)}`
    );
    if (!res.body) throw new Error("Backup download response has no body");
    return res.body;
  }

  async function deleteBackup(filename: string): Promise<void> {
    await apiFetch(`/api/admin/backups/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    });
  }

  return { createBackup, listBackups, getDownloadToken, downloadBackup, deleteBackup };
}

export type MealieClient = ReturnType<typeof createMealieClient>;

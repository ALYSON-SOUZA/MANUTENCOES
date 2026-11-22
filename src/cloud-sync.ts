import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleAuthProvider } from './lib/firebase.ts';

let memoryIdToken: string | null = null;
let currentUser: User | null = auth.currentUser;
const authReadyCallbacks: Array<(user: User | null) => void> = [];
let authResolved = false;

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    try {
      memoryIdToken = await user.getIdToken();
    } catch {
      memoryIdToken = null;
    }
  } else {
    memoryIdToken = null;
  }
  authResolved = true;
  while (authReadyCallbacks.length > 0) {
    const cb = authReadyCallbacks.shift();
    if (cb) cb(user);
  }
});

async function getFreshToken(): Promise<string> {
  if (!currentUser) {
    throw new Error('Sessão Google não autenticada.');
  }
  memoryIdToken = await currentUser.getIdToken();
  return memoryIdToken;
}

async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = await getFreshToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Erro HTTP ${res.status}`);
  }
  return data as T;
}

export interface CloudBridge {
  isAvailable: boolean;
  waitForAuth: () => Promise<User | null>;
  hasAuthUser: () => boolean;
  getCurrentUserInfo: () => { email: string; displayName: string } | null;
  signInAndLoad: (name: string, cpf: string, sampleRecords: unknown[]) => Promise<{
    user: { name: string; cpf: string; isMaster: boolean; email: string };
    records: unknown[];
    auditLogs: unknown[];
  }>;
  syncExistingAndLoad: (name: string, cpf: string, sampleRecords: unknown[]) => Promise<{
    user: { name: string; cpf: string; isMaster: boolean; email: string };
    records: unknown[];
    auditLogs: unknown[];
  } | null>;
  signOutGoogle: () => Promise<void>;
  createRecord: (record: unknown) => Promise<unknown>;
  updateRecord: (id: string, record: unknown) => Promise<unknown>;
  deleteRecord: (id: string) => Promise<void>;
  bulkImport: (records: unknown[], action?: string) => Promise<{ records: unknown[]; auditLogs: unknown[] }>;
  clearAllRecords: () => Promise<void>;
  appendAuditLog: (log: unknown) => Promise<void>;
  fetchAll: () => Promise<{ records: unknown[]; auditLogs: unknown[] }>;
}

const cloudBridge: CloudBridge = {
  isAvailable: true,

  waitForAuth() {
    if (authResolved) {
      return Promise.resolve(currentUser);
    }
    return new Promise((resolve) => {
      authReadyCallbacks.push(resolve);
    });
  },

  hasAuthUser() {
    return Boolean(currentUser);
  },

  getCurrentUserInfo() {
    if (!currentUser) return null;
    return {
      email: currentUser.email || '',
      displayName: currentUser.displayName || '',
    };
  },

  async signInAndLoad(name: string, cpf: string, sampleRecords: unknown[]) {
    if (!currentUser) {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      currentUser = cred.user;
    }
    memoryIdToken = await currentUser.getIdToken();

    const sessionRes = await apiRequest<{
      user: { name: string; cpf: string; isMaster: boolean; email: string };
    }>('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ name, cpf, logLogin: true }),
    });

    let data = await apiRequest<{ records: unknown[]; auditLogs: unknown[] }>('/api/records');
    if (data.records.length === 0 && sampleRecords.length > 0) {
      data = await apiRequest<{ records: unknown[]; auditLogs: unknown[] }>('/api/records/seed', {
        method: 'POST',
        body: JSON.stringify({ records: sampleRecords }),
      });
    }

    return {
      user: sessionRes.user,
      records: data.records,
      auditLogs: data.auditLogs,
    };
  },

  async syncExistingAndLoad(name: string, cpf: string, sampleRecords: unknown[]) {
    const user = await this.waitForAuth();
    if (!user) return null;

    const sessionRes = await apiRequest<{
      user: { name: string; cpf: string; isMaster: boolean; email: string };
    }>('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ name, cpf, logLogin: false }),
    });

    let data = await apiRequest<{ records: unknown[]; auditLogs: unknown[] }>('/api/records');
    if (data.records.length === 0 && sampleRecords.length > 0) {
      data = await apiRequest<{ records: unknown[]; auditLogs: unknown[] }>('/api/records/seed', {
        method: 'POST',
        body: JSON.stringify({ records: sampleRecords }),
      });
    }

    return {
      user: sessionRes.user,
      records: data.records,
      auditLogs: data.auditLogs,
    };
  },

  async signOutGoogle() {
    memoryIdToken = null;
    currentUser = null;
    await signOut(auth);
  },

  async createRecord(record: unknown) {
    const res = await apiRequest<{ record: unknown }>('/api/records', {
      method: 'POST',
      body: JSON.stringify(record),
    });
    return res.record;
  },

  async updateRecord(id: string, record: unknown) {
    const res = await apiRequest<{ record: unknown }>(`/api/records/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    return res.record;
  },

  async deleteRecord(id: string) {
    await apiRequest(`/api/records/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async bulkImport(records: unknown[], action?: string) {
    return await apiRequest<{ records: unknown[]; auditLogs: unknown[] }>('/api/records/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ records, action }),
    });
  },

  async clearAllRecords() {
    await apiRequest('/api/records', { method: 'DELETE' });
  },

  async appendAuditLog(log: unknown) {
    await apiRequest('/api/audit-logs', {
      method: 'POST',
      body: JSON.stringify(log),
    });
  },

  async fetchAll() {
    return await apiRequest<{ records: unknown[]; auditLogs: unknown[] }>('/api/records');
  },
};

declare global {
  interface Window {
    __CMMS_CLOUD__?: CloudBridge;
  }
}

window.__CMMS_CLOUD__ = cloudBridge;
window.dispatchEvent(new CustomEvent('cmms-cloud-ready'));

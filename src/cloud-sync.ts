import { getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';
import { auth as initialAuth, googleAuthProvider } from './lib/firebase.ts';

let activeAuth: Auth = initialAuth;
let memoryIdToken: string | null = null;
let currentUser: User | null = activeAuth.currentUser;
const authReadyCallbacks: Array<(user: User | null) => void> = [];
let authResolved = false;

function attachAuthListener(authInstance: Auth) {
  onAuthStateChanged(authInstance, async (user) => {
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
}

attachAuthListener(activeAuth);

function resetAuthInstance() {
  const appName = `cmms_auth_${Date.now()}`;
  const existing = getApps().find((a) => a.name === appName);
  const freshApp = existing || initializeApp(firebaseConfig, appName);
  activeAuth = getAuth(freshApp);
  attachAuthListener(activeAuth);
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const cleanHost = hostname.toLowerCase();
  const cleanDomain = domain.toLowerCase();
  return cleanHost === cleanDomain || cleanHost.endsWith(`.${cleanDomain}`);
}

async function isCurrentHostAuthorized(): Promise<boolean> {
  try {
    const hostname = window.location.hostname;
    if (!hostname) return false;
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(firebaseConfig.apiKey)}`
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { authorizedDomains?: string[] };
    const list = Array.isArray(data.authorizedDomains) ? data.authorizedDomains : [];
    return list.some((d) => hostnameMatchesDomain(hostname, d));
  } catch {
    return false;
  }
}

async function buildFriendlyAuthError(err: unknown): Promise<Error> {
  const code = (err as { code?: string })?.code || '';
  const hostname = window.location.hostname || window.location.origin;

  if (code === 'auth/unauthorized-domain') {
    resetAuthInstance();
    const authorizedNow = await isCurrentHostAuthorized();
    if (authorizedNow) {
      return new Error(
        `O domínio "${hostname}" já está autorizado, mas havia cache da tentativa anterior. Clique em "Entrar no Sistema" novamente.`
      );
    }
    return new Error(
      `Domínio não autorizado no login Google (${hostname}). Adicione "${hostname}" em Firebase Console → Authentication → Configurações → Domínios autorizados (Projeto: ${firebaseConfig.projectId}) e clique em Entrar novamente.`
    );
  }

  if (code === 'auth/popup-blocked') {
    return new Error(
      'O navegador bloqueou a janela de login do Google. Habilite pop-ups para este endereço e tente novamente.'
    );
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return new Error('O login Google foi fechado antes da conclusão. Tente entrar novamente.');
  }
  if (code === 'auth/network-request-failed') {
    return new Error('Falha de conexão ao autenticar com o Google. Verifique sua rede e tente novamente.');
  }

  const rawMsg = err instanceof Error ? err.message : String(err || 'Falha na autenticação.');
  return new Error(rawMsg);
}

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
      try {
        const cred = await signInWithPopup(activeAuth, googleAuthProvider);
        currentUser = cred.user;
      } catch (err) {
        throw await buildFriendlyAuthError(err);
      }
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
    await signOut(activeAuth);
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

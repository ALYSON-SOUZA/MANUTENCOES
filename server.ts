import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { AuthRequest, requireAuth } from './src/middleware/auth.ts';
import { getOrCreateUser, getUserByUid } from './src/db/users.ts';
import {
  appendAuditLog,
  clearAllMaintenanceRecords,
  createMaintenanceRecord,
  deleteMaintenanceRecordById,
  listAuditLogs,
  listMaintenanceRecords,
  replaceAllMaintenanceRecords,
  seedRecordsIfDatabaseEmpty,
  updateMaintenanceRecord,
} from './src/db/records.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '15mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/session', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email || `${uid}@auth.local`;
    const body = req.body || {};
    const name = String(body.name || req.user!.name || email).trim();
    const cpf = String(body.cpf || '');

    const dbUser = await getOrCreateUser(uid, email, name, cpf);

    if (body.logLogin) {
      await appendAuditLog(
        {
          id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          userName: dbUser.displayName || name,
          isMaster: dbUser.isMaster,
          action: 'Login',
          detail: `Acesso iniciado por ${dbUser.displayName || name}${dbUser.isMaster ? ' (Master)' : ''}.`,
        },
        dbUser.id
      );
    }

    res.json({
      user: {
        id: dbUser.id,
        uid: dbUser.uid,
        email: dbUser.email,
        name: dbUser.displayName,
        cpf: dbUser.cpf,
        isMaster: dbUser.isMaster,
      },
    });
  } catch (error: any) {
    console.error('Failed to sync user session:', error);
    res.status(500).json({ error: error.message || 'Falha ao autenticar sessão.' });
  }
});

app.get('/api/records', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email || `${uid}@auth.local`;
    await getOrCreateUser(uid, email, req.user!.name);

    const [records, logs] = await Promise.all([
      listMaintenanceRecords(),
      listAuditLogs(),
    ]);
    res.json({ records, auditLogs: logs });
  } catch (error: any) {
    console.error('Failed to fetch records:', error);
    res.status(500).json({ error: error.message || 'Erro ao buscar registros.' });
  }
});

app.post('/api/records/seed', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email || `${uid}@auth.local`;
    const dbUser = await getOrCreateUser(uid, email, req.user!.name);
    const items = Array.isArray(req.body?.records) ? req.body.records : [];
    const records = await seedRecordsIfDatabaseEmpty(items, dbUser.id);
    const logs = await listAuditLogs();
    res.json({ records, auditLogs: logs });
  } catch (error: any) {
    console.error('Failed to seed records:', error);
    res.status(500).json({ error: error.message || 'Erro ao inicializar base.' });
  }
});

app.post('/api/records', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email || `${uid}@auth.local`;
    const dbUser = await getOrCreateUser(uid, email, req.user!.name);
    const body = req.body || {};

    if (!body.ticketNumber || !body.assetName || Number(body.value) <= 0) {
      return res.status(400).json({ error: 'Campos obrigatórios inválidos para lançamento.' });
    }

    const record = await createMaintenanceRecord(
      {
        id: String(body.id || `os_${Date.now().toString(36)}`),
        ticketNumber: String(body.ticketNumber).trim(),
        category: String(body.category || 'Outras'),
        assetName: String(body.assetName).trim(),
        type: body.type === 'Corretiva' ? 'Corretiva' : 'Preventiva',
        performedDate: String(body.performedDate || ''),
        nextDate: String(body.nextDate || ''),
        warrantyDays: String(body.warrantyDays || ''),
        warrantyEndDate: String(body.warrantyEndDate || ''),
        value: Number(body.value),
        photo: typeof body.photo === 'string' ? body.photo : '',
        createdBy: dbUser.displayName || String(body.createdBy || 'Operador'),
        createdByMaster: dbUser.isMaster,
        createdAt: body.createdAt,
        updatedBy: dbUser.displayName || String(body.updatedBy || 'Operador'),
        updatedByMaster: dbUser.isMaster,
        updatedAt: body.updatedAt,
      },
      dbUser.id
    );

    await appendAuditLog(
      {
        id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        userName: dbUser.displayName || record.createdBy,
        isMaster: dbUser.isMaster,
        action: 'Inclusão',
        detail: `${record.ticketNumber} · ${record.assetName} (${record.type}) · R$ ${record.value.toFixed(2)}`,
      },
      dbUser.id
    );

    res.status(201).json({ record });
  } catch (error: any) {
    console.error('Failed to create record:', error);
    res.status(500).json({ error: error.message || 'Erro ao criar registro.' });
  }
});

app.put('/api/records/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email || `${uid}@auth.local`;
    const dbUser = await getOrCreateUser(uid, email, req.user!.name);
    const id = String(req.params.id);
    const body = req.body || {};

    if (!body.ticketNumber || !body.assetName || Number(body.value) <= 0) {
      return res.status(400).json({ error: 'Campos obrigatórios inválidos para atualização.' });
    }

    const updated = await updateMaintenanceRecord(id, {
      ticketNumber: String(body.ticketNumber).trim(),
      category: String(body.category || 'Outras'),
      assetName: String(body.assetName).trim(),
      type: body.type === 'Corretiva' ? 'Corretiva' : 'Preventiva',
      performedDate: String(body.performedDate || ''),
      nextDate: String(body.nextDate || ''),
      warrantyDays: String(body.warrantyDays || ''),
      warrantyEndDate: String(body.warrantyEndDate || ''),
      value: Number(body.value),
      photo: typeof body.photo === 'string' ? body.photo : undefined,
      updatedBy: dbUser.displayName || String(body.updatedBy || 'Operador'),
      updatedByMaster: dbUser.isMaster,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Registro não encontrado.' });
    }

    await appendAuditLog(
      {
        id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        userName: dbUser.displayName || updated.updatedBy,
        isMaster: dbUser.isMaster,
        action: 'Edição',
        detail: `${updated.ticketNumber} · ${updated.assetName} · R$ ${updated.value.toFixed(2)}`,
      },
      dbUser.id
    );

    res.json({ record: updated });
  } catch (error: any) {
    console.error('Failed to update record:', error);
    res.status(500).json({ error: error.message || 'Erro ao atualizar registro.' });
  }
});

app.delete('/api/records/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = await getUserByUid(req.user!.uid);
    if (!dbUser || !dbUser.isMaster) {
      return res.status(403).json({
        error: 'Exclusão restrita ao CPF Master (61881619320).',
      });
    }

    const id = String(req.params.id);
    const deleted = await deleteMaintenanceRecordById(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Registro não encontrado.' });
    }

    await appendAuditLog(
      {
        id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        userName: dbUser.displayName || 'Master',
        isMaster: true,
        action: 'Exclusão (Master)',
        detail: `${deleted.ticketNumber} · ${deleted.assetName} · R$ ${deleted.value.toFixed(2)}`,
      },
      dbUser.id
    );

    res.json({ ok: true, id });
  } catch (error: any) {
    console.error('Failed to delete record:', error);
    res.status(500).json({ error: error.message || 'Erro ao excluir registro.' });
  }
});

app.post('/api/records/bulk-import', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email || `${uid}@auth.local`;
    const dbUser = await getOrCreateUser(uid, email, req.user!.name);
    const items = Array.isArray(req.body?.records) ? req.body.records : null;

    if (!items) {
      return res.status(400).json({ error: 'Lista de registros inválida.' });
    }

    const records = await replaceAllMaintenanceRecords(items, dbUser.id);
    await appendAuditLog(
      {
        id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        userName: dbUser.displayName || 'Operador',
        isMaster: dbUser.isMaster,
        action: String(req.body?.action || 'Importação JSON'),
        detail: `${records.length} registro(s) sincronizado(s).`,
      },
      dbUser.id
    );

    const logs = await listAuditLogs();
    res.json({ records, auditLogs: logs });
  } catch (error: any) {
    console.error('Failed to bulk import records:', error);
    res.status(500).json({ error: error.message || 'Erro ao importar registros.' });
  }
});

app.delete('/api/records', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = await getUserByUid(req.user!.uid);
    if (!dbUser || !dbUser.isMaster) {
      return res.status(403).json({
        error: 'Limpeza total permitida apenas para o CPF Master (61881619320).',
      });
    }

    await clearAllMaintenanceRecords();
    await appendAuditLog(
      {
        id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        userName: dbUser.displayName || 'Master',
        isMaster: true,
        action: 'Limpeza Total (Master)',
        detail: 'Todos os registros foram removidos.',
      },
      dbUser.id
    );

    res.json({ ok: true });
  } catch (error: any) {
    console.error('Failed to clear all records:', error);
    res.status(500).json({ error: error.message || 'Erro ao limpar base.' });
  }
});

app.get('/api/audit-logs', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const logs = await listAuditLogs();
    res.json({ auditLogs: logs });
  } catch (error: any) {
    console.error('Failed to list audit logs:', error);
    res.status(500).json({ error: error.message || 'Erro ao consultar auditoria.' });
  }
});

app.post('/api/audit-logs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const email = req.user!.email || `${uid}@auth.local`;
    const dbUser = await getOrCreateUser(uid, email, req.user!.name);
    const body = req.body || {};

    const log = await appendAuditLog(
      {
        id: String(body.id || `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`),
        userName: dbUser.displayName || String(body.user || 'Operador'),
        isMaster: dbUser.isMaster,
        action: String(body.action || 'Evento'),
        detail: String(body.detail || ''),
      },
      dbUser.id
    );
    res.status(201).json({ log });
  } catch (error: any) {
    console.error('Failed to append audit log:', error);
    res.status(500).json({ error: error.message || 'Erro ao registrar auditoria.' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

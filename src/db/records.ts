import { desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { auditLogs, maintenanceRecords } from './schema.ts';

export interface MaintenanceRecordInput {
  id: string;
  ticketNumber: string;
  category: string;
  assetName: string;
  type: 'Preventiva' | 'Corretiva';
  performedDate: string;
  nextDate?: string;
  warrantyDays?: string;
  warrantyEndDate?: string;
  value: number;
  createdBy: string;
  createdByMaster: boolean;
  createdAt?: string;
  updatedBy: string;
  updatedByMaster: boolean;
  updatedAt?: string;
}

export interface AuditLogInput {
  id: string;
  userName: string;
  isMaster: boolean;
  action: string;
  detail: string;
  timestamp?: string;
}

function serializeRecord(row: typeof maintenanceRecords.$inferSelect) {
  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    category: row.category,
    assetName: row.assetName,
    type: row.type === 'Corretiva' ? 'Corretiva' : 'Preventiva',
    performedDate: row.performedDate,
    nextDate: row.nextDate || '',
    warrantyDays: row.warrantyDays || '',
    warrantyEndDate: row.warrantyEndDate || '',
    value: Number(row.value || 0),
    createdBy: row.createdBy,
    createdByMaster: Boolean(row.createdByMaster),
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
    updatedBy: row.updatedBy,
    updatedByMaster: Boolean(row.updatedByMaster),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : new Date().toISOString(),
  };
}

function serializeAuditLog(row: typeof auditLogs.$inferSelect) {
  return {
    id: row.id,
    timestamp: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
    user: row.userName,
    isMaster: Boolean(row.isMaster),
    action: row.action,
    detail: row.detail,
  };
}

export async function listMaintenanceRecords() {
  try {
    const rows = await db
      .select()
      .from(maintenanceRecords)
      .orderBy(desc(maintenanceRecords.createdAt));
    return rows.map(serializeRecord);
  } catch (error) {
    console.error('Database query failed (listMaintenanceRecords):', error);
    throw new Error('Erro ao carregar registros de manutenção.', { cause: error });
  }
}

export async function createMaintenanceRecord(
  input: MaintenanceRecordInput,
  userId: number | null
) {
  try {
    const now = new Date();
    const inserted = await db
      .insert(maintenanceRecords)
      .values({
        id: input.id,
        ticketNumber: input.ticketNumber,
        category: input.category,
        assetName: input.assetName,
        type: input.type,
        performedDate: input.performedDate,
        nextDate: input.nextDate || '',
        warrantyDays: input.warrantyDays || '',
        warrantyEndDate: input.warrantyEndDate || '',
        value: Number(input.value || 0),
        createdBy: input.createdBy,
        createdByMaster: Boolean(input.createdByMaster),
        updatedBy: input.updatedBy,
        updatedByMaster: Boolean(input.updatedByMaster),
        userId,
        createdAt: input.createdAt ? new Date(input.createdAt) : now,
        updatedAt: input.updatedAt ? new Date(input.updatedAt) : now,
      })
      .onConflictDoUpdate({
        target: maintenanceRecords.id,
        set: {
          ticketNumber: input.ticketNumber,
          category: input.category,
          assetName: input.assetName,
          type: input.type,
          performedDate: input.performedDate,
          nextDate: input.nextDate || '',
          warrantyDays: input.warrantyDays || '',
          warrantyEndDate: input.warrantyEndDate || '',
          value: Number(input.value || 0),
          updatedBy: input.updatedBy,
          updatedByMaster: Boolean(input.updatedByMaster),
          updatedAt: now,
        },
      })
      .returning();

    return serializeRecord(inserted[0]);
  } catch (error) {
    console.error('Database query failed (createMaintenanceRecord):', error);
    throw new Error('Erro ao salvar registro de manutenção.', { cause: error });
  }
}

export async function updateMaintenanceRecord(
  id: string,
  input: Partial<MaintenanceRecordInput>
) {
  try {
    const now = new Date();
    const updated = await db
      .update(maintenanceRecords)
      .set({
        ticketNumber: input.ticketNumber,
        category: input.category,
        assetName: input.assetName,
        type: input.type,
        performedDate: input.performedDate,
        nextDate: input.nextDate ?? '',
        warrantyDays: input.warrantyDays ?? '',
        warrantyEndDate: input.warrantyEndDate ?? '',
        value: input.value !== undefined ? Number(input.value) : undefined,
        updatedBy: input.updatedBy,
        updatedByMaster: Boolean(input.updatedByMaster),
        updatedAt: now,
      })
      .where(eq(maintenanceRecords.id, id))
      .returning();

    return updated[0] ? serializeRecord(updated[0]) : null;
  } catch (error) {
    console.error('Database query failed (updateMaintenanceRecord):', error);
    throw new Error('Erro ao atualizar registro de manutenção.', { cause: error });
  }
}

export async function deleteMaintenanceRecordById(id: string) {
  try {
    const deleted = await db
      .delete(maintenanceRecords)
      .where(eq(maintenanceRecords.id, id))
      .returning();
    return deleted[0] ? serializeRecord(deleted[0]) : null;
  } catch (error) {
    console.error('Database query failed (deleteMaintenanceRecordById):', error);
    throw new Error('Erro ao excluir registro de manutenção.', { cause: error });
  }
}

export async function replaceAllMaintenanceRecords(
  items: MaintenanceRecordInput[],
  userId: number | null
) {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(maintenanceRecords);
      if (items.length > 0) {
        const rows = items.map((item) => ({
          id: String(item.id),
          ticketNumber: String(item.ticketNumber || ''),
          category: String(item.category || 'Outras'),
          assetName: String(item.assetName || ''),
          type: item.type === 'Corretiva' ? 'Corretiva' : 'Preventiva',
          performedDate: String(item.performedDate || ''),
          nextDate: String(item.nextDate || ''),
          warrantyDays: String(item.warrantyDays || ''),
          warrantyEndDate: String(item.warrantyEndDate || ''),
          value: Number(item.value || 0),
          createdBy: String(item.createdBy || 'Operador'),
          createdByMaster: Boolean(item.createdByMaster),
          updatedBy: String(item.updatedBy || item.createdBy || 'Operador'),
          updatedByMaster: Boolean(item.updatedByMaster),
          userId,
          createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
          updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
        }));
        await tx.insert(maintenanceRecords).values(rows);
      }
    });
    return await listMaintenanceRecords();
  } catch (error) {
    console.error('Database query failed (replaceAllMaintenanceRecords):', error);
    throw new Error('Erro ao importar registros em lote.', { cause: error });
  }
}

export async function seedRecordsIfDatabaseEmpty(
  items: MaintenanceRecordInput[],
  userId: number | null
) {
  try {
    const existing = await db
      .select({ id: maintenanceRecords.id })
      .from(maintenanceRecords)
      .limit(1);

    if (existing.length > 0 || items.length === 0) {
      return await listMaintenanceRecords();
    }

    const rows = items.map((item) => ({
      id: String(item.id),
      ticketNumber: String(item.ticketNumber || ''),
      category: String(item.category || 'Outras'),
      assetName: String(item.assetName || ''),
      type: item.type === 'Corretiva' ? 'Corretiva' : 'Preventiva',
      performedDate: String(item.performedDate || ''),
      nextDate: String(item.nextDate || ''),
      warrantyDays: String(item.warrantyDays || ''),
      warrantyEndDate: String(item.warrantyEndDate || ''),
      value: Number(item.value || 0),
      createdBy: String(item.createdBy || 'Operador'),
      createdByMaster: Boolean(item.createdByMaster),
      updatedBy: String(item.updatedBy || item.createdBy || 'Operador'),
      updatedByMaster: Boolean(item.updatedByMaster),
      userId,
      createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
      updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
    }));

    await db.insert(maintenanceRecords).values(rows).onConflictDoNothing();
    return await listMaintenanceRecords();
  } catch (error) {
    console.error('Database query failed (seedRecordsIfDatabaseEmpty):', error);
    throw new Error('Erro ao inicializar registros de demonstração.', { cause: error });
  }
}

export async function clearAllMaintenanceRecords() {
  try {
    await db.delete(maintenanceRecords);
    return true;
  } catch (error) {
    console.error('Database query failed (clearAllMaintenanceRecords):', error);
    throw new Error('Erro ao limpar base de manutenções.', { cause: error });
  }
}

export async function listAuditLogs() {
  try {
    const rows = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(250);
    return rows.map(serializeAuditLog);
  } catch (error) {
    console.error('Database query failed (listAuditLogs):', error);
    throw new Error('Erro ao carregar histórico de auditoria.', { cause: error });
  }
}

export async function appendAuditLog(
  input: AuditLogInput,
  userId: number | null
) {
  try {
    const inserted = await db
      .insert(auditLogs)
      .values({
        id: input.id,
        userId,
        userName: input.userName,
        isMaster: Boolean(input.isMaster),
        action: input.action,
        detail: input.detail,
        createdAt: input.timestamp ? new Date(input.timestamp) : new Date(),
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0] ? serializeAuditLog(inserted[0]) : null;
  } catch (error) {
    console.error('Database query failed (appendAuditLog):', error);
    throw new Error('Erro ao registrar evento de auditoria.', { cause: error });
  }
}

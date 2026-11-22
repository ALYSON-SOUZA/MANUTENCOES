import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';

const MASTER_CPF = '61881619320';

export function normalizeCpfDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string,
  cpf?: string
) {
  const cleanCpf = normalizeCpfDigits(cpf || '');
  const cleanName = String(displayName || '').trim();
  const isMaster = cleanCpf === MASTER_CPF;

  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);

    const nextDisplayName = cleanName || existing[0]?.displayName || email;
    const nextCpf = cleanCpf || existing[0]?.cpf || '';
    const nextIsMaster = cleanCpf ? isMaster : Boolean(existing[0]?.isMaster);

    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: nextDisplayName,
        cpf: nextCpf,
        isMaster: nextIsMaster,
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          displayName: nextDisplayName,
          cpf: nextCpf,
          isMaster: nextIsMaster,
          lastLoginAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed (getOrCreateUser):', error);
    throw new Error('Falha ao sincronizar usuário no banco de dados.', { cause: error });
  }
}

export async function getUserByUid(uid: string) {
  try {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('Database query failed (getUserByUid):', error);
    throw new Error('Falha ao consultar perfil do usuário.', { cause: error });
  }
}

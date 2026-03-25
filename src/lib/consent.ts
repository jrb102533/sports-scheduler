import { doc, setDoc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { LegalDocumentType } from '@/legal/versions';

export interface ConsentRecord {
  version: string;
  agreedAt: string;
}

/**
 * Writes a consent record for a user.
 * Path: users/{uid}/consents/{type}
 */
export async function recordConsent(
  uid: string,
  type: LegalDocumentType,
  version: string,
): Promise<void> {
  const record: ConsentRecord = {
    version,
    agreedAt: new Date().toISOString(),
  };
  await setDoc(doc(db, 'users', uid, 'consents', type), record);
}

/**
 * Reads all consent records for a user.
 * Returns a map of document type to record (or null if not found).
 */
export async function getUserConsents(
  uid: string,
): Promise<Record<LegalDocumentType, ConsentRecord | null>> {
  const types: LegalDocumentType[] = ['privacyPolicy', 'termsOfService', 'marketingEmail'];
  const result: Record<LegalDocumentType, ConsentRecord | null> = {
    privacyPolicy: null,
    termsOfService: null,
    marketingEmail: null,
  };

  await Promise.all(
    types.map(async (type) => {
      const snap = await getDoc(doc(db, 'users', uid, 'consents', type));
      if (snap.exists()) {
        result[type] = snap.data() as ConsentRecord;
      }
    }),
  );

  return result;
}

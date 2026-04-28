import { RuleTester } from 'eslint';
import rule from './no-unscoped-collection-read.js';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-unscoped-collection-read', rule, {
  valid: [
    "getDocs(query(collection(db, 'x'), where('a', '==', 1)));",
    "getDocs(query(collection(db, 'x'), limit(50)));",
    "getDocs(query(collection(db, 'x'), where('a', '==', 1), orderBy('createdAt')));",
    "onSnapshot(query(collection(db, 'x'), where('a', '==', 1)), cb);",
    "getDocs(query(collection(db, 'x'), ...constraints));",
    "getDoc(doc(db, 'x', '1'));",
    // Subcollection paths are bounded by parent doc — not unscoped.
    "getDocs(collection(db, 'events', eventId, 'rsvps'));",
    "onSnapshot(collection(db, 'leagues', leagueId, 'venues'), cb);",
  ],
  invalid: [
    {
      code: "getDocs(collection(db, 'x'));",
      errors: [{ messageId: 'unscopedCollection' }],
    },
    {
      code: "onSnapshot(collection(db, 'events'), cb);",
      errors: [{ messageId: 'unscopedCollection' }],
    },
    {
      code: "getDocs(collectionGroup(db, 'sensitiveData'));",
      errors: [{ messageId: 'unscopedCollection' }],
    },
    {
      code: "getDocs(query(collection(db, 'x'), orderBy('createdAt')));",
      errors: [{ messageId: 'unscopedQuery' }],
    },
  ],
});

console.log('no-unscoped-collection-read: all RuleTester cases passed.');

/**
 * Bans `getDocs(collection(...))` and `onSnapshot(collection(...))` without a
 * `query(...)` wrapper containing `where(...)` or `limit(...)`. An unscoped
 * collection read fans out to every document and is the dominant cause of
 * Firestore quota burn on this project (see ADR-012, FW-80).
 *
 * Allowed:
 *   getDocs(query(collection(db, 'x'), where(...)))
 *   getDocs(query(collection(db, 'x'), limit(50)))
 *   onSnapshot(query(collection(db, 'x'), where(...)), cb)
 *
 * Flagged:
 *   getDocs(collection(db, 'x'))
 *   onSnapshot(collection(db, 'x'), cb)
 *   getDocs(query(collection(db, 'x'), orderBy('createdAt')))   // orderBy alone is not a scope
 */

const READ_FNS = new Set(['getDocs', 'onSnapshot']);
const SCOPING_HELPERS = new Set(['where', 'limit']);

function getCalleeName(node) {
  if (!node || node.type !== 'CallExpression') return null;
  if (node.callee.type === 'Identifier') return node.callee.name;
  if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
    return node.callee.property.name;
  }
  return null;
}

function isCollectionCall(node) {
  if (!node || node.type !== 'CallExpression') return false;
  const name = getCalleeName(node);
  if (name === 'collectionGroup') return true;
  if (name !== 'collection') return false;
  // collection(db, 'foo')                     → 2 args, top-level (UNSCOPED — flag)
  // collection(db, 'foo', id, 'sub')          → 4 args, bounded by parent doc (skip)
  // collection(db, 'foo', id, 'sub', id, ...) → 6+ args, deeper bounded (skip)
  // Even arg counts >= 4 indicate a subcollection rooted at a specific parent doc.
  return node.arguments.length <= 2;
}

function isQueryCall(node) {
  return getCalleeName(node) === 'query';
}

function queryHasScope(queryNode) {
  // query(collection(...), ...modifiers)
  for (let i = 1; i < queryNode.arguments.length; i++) {
    const arg = queryNode.arguments[i];
    if (arg.type === 'CallExpression' && SCOPING_HELPERS.has(getCalleeName(arg))) {
      return true;
    }
    // A spread argument (...constraints) — assume scoped, since the constraint
    // array is built dynamically. The caller is responsible.
    if (arg.type === 'SpreadElement') return true;
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow unscoped Firestore collection reads. Use query(collection(...), where|limit) to bound reads.',
    },
    schema: [],
    messages: {
      unscopedCollection:
        'Unscoped Firestore read on `{{name}}`. Wrap in query(...) with where(...) or limit(...) — see ADR-012.',
      unscopedQuery:
        'query(...) on `{{name}}` has no where/limit constraint. orderBy alone does not bound reads.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const fn = getCalleeName(node);
        if (!READ_FNS.has(fn)) return;
        const target = node.arguments[0];
        if (!target || target.type !== 'CallExpression') return;

        if (isCollectionCall(target)) {
          // getDocs(collection(...)) — direct unscoped read
          context.report({
            node,
            messageId: 'unscopedCollection',
            data: { name: target.callee.name || 'collection' },
          });
          return;
        }

        if (isQueryCall(target)) {
          // getDocs(query(collection(...), ...)) — only flag if no where/limit
          const innerCollection = target.arguments[0];
          if (
            innerCollection &&
            innerCollection.type === 'CallExpression' &&
            isCollectionCall(innerCollection) &&
            !queryHasScope(target)
          ) {
            context.report({
              node,
              messageId: 'unscopedQuery',
              data: { name: innerCollection.callee.name || 'collection' },
            });
          }
        }
      },
    };
  },
};

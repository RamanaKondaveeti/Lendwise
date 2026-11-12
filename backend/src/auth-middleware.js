const { logError, logWarn } = require('./logger');

function getSessionToken(req, cookieName = 'lendwise_session') {
  const cookies = req.headers.cookie || '';
  const cookie = cookies.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`));
  return cookie?.slice(cookieName.length + 1) || '';
}

function createRequireAuth({ lookupAccount, clearSessionCookie }) {
  return async function requireAuth(req, res, next) {
    const token = getSessionToken(req);
    if (!token) {
      logWarn('authentication_failed');
      return res.status(401).json({ error: 'Sign in to continue.' });
    }
    try {
      const account = await lookupAccount(token);
      if (!account) {
        logWarn('authentication_failed');
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
      }
      req.account = account;
      return next();
    } catch (error) {
      logError('authentication_lookup_failed', error);
      return res.status(500).json({ error: 'Could not verify your session.' });
    }
  };
}

function createApiAuthGate({ requireAuth }) {
  const publicHealthPaths = new Set(['/health', '/health/live', '/health/ready']);
  return function apiAuthGate(req, res, next) {
    if ((req.method === 'GET' && publicHealthPaths.has(req.path)) ||
        req.path.startsWith('/auth/') ||
        (req.method === 'POST' && req.path === '/invitations/preview') ||
        (req.method === 'GET' && /^\/invitations\/[^/]+$/.test(req.path))) return next();
    return requireAuth(req, res, next);
  };
}

module.exports = { createApiAuthGate, createRequireAuth, getSessionToken };

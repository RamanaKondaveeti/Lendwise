function getSessionToken(req, cookieName = 'lendwise_session') {
  const cookies = req.headers.cookie || '';
  const cookie = cookies.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`));
  return cookie?.slice(cookieName.length + 1) || '';
}

function createRequireAuth({ lookupAccount, clearSessionCookie }) {
  return async function requireAuth(req, res, next) {
    const token = getSessionToken(req);
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
    try {
      const account = await lookupAccount(token);
      if (!account) {
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
      }
      req.account = account;
      return next();
    } catch {
      return res.status(500).json({ error: 'Could not verify your session.' });
    }
  };
}

module.exports = { createRequireAuth, getSessionToken };

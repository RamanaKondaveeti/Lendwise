const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const requestContext = new AsyncLocalStorage();
const requestIdPattern = /^[A-Za-z0-9._-]{8,64}$/;

function createRequestId(candidate) {
  const value = typeof candidate === 'string' ? candidate.trim() : '';
  return requestIdPattern.test(value) ? value : randomUUID();
}

function safeText(value, maxLength = 128) {
  return String(value).replace(/[\r\n\t\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

function writeLog(level, event, fields = {}, sink = console.log) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event: typeof event === 'string' && /^[a-z][a-z0-9_]{1,48}$/.test(event)
      ? event
      : 'application_event',
  };
  const requestId = fields.requestId ?? requestContext.getStore()?.requestId;
  if (requestId) record.requestId = safeText(requestId, 64);
  if (fields.method) record.method = safeText(fields.method, 12);
  if (fields.route) record.route = safeText(fields.route, 160);
  if (Number.isInteger(fields.status)) record.status = fields.status;
  if (Number.isFinite(fields.durationMs)) record.durationMs = Math.max(0, Math.round(fields.durationMs * 100) / 100);
  if (fields.errorCode && /^(?:ER_[A-Z0-9_]{1,40}|E[A-Z0-9_]{1,40}|ERR_[A-Z0-9_]{1,40}|PROTOCOL_[A-Z0-9_]{1,40}|[A-Z][a-zA-Z]{0,24}Error)$/.test(fields.errorCode)) {
    record.errorCode = fields.errorCode;
  }
  if (fields.dependency) record.dependency = safeText(fields.dependency, 32);
  sink(JSON.stringify(record));
  return record;
}

function logInfo(event, fields = {}) {
  return writeLog('info', event, fields);
}

function logWarn(event, fields = {}) {
  return writeLog('warn', event, fields);
}

function logError(event, error) {
  if (error === undefined && event instanceof Error) {
    error = event;
    event = 'application_error';
  }
  const errorCode = error && typeof error.code === 'string'
    ? error.code
    : error && typeof error.name === 'string' ? error.name : undefined;
  return writeLog('error', event, { errorCode });
}

function requestObservability(req, res, next) {
  const requestId = createRequestId(req.get('x-request-id'));
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  const started = process.hrtime.bigint();

  const originalJson = res.json.bind(res);
  res.json = body => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
      body = { ...body, requestId };
    }
    return originalJson(body);
  };

  res.once('finish', () => {
    if (!req.path.startsWith('/api/')) return;
    const routePath = req.route?.path;
    const route = routePath
      ? `${req.baseUrl || ''}${routePath}`
      : req.path === '/api' ? '/api' : '/api/unmatched';
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    writeLog('info', 'http_request', {
      requestId,
      method: req.method,
      route,
      status: res.statusCode,
      durationMs,
    });
  });

  requestContext.run({ requestId }, next);
}

function rateLimitHandler(req, res, message = 'Too many requests. Please wait and try again.') {
  logWarn('rate_limit_exceeded');
  return res.status(429).json({ error: message });
}

module.exports = {
  createRequestId,
  logError,
  logInfo,
  logWarn,
  rateLimitHandler,
  requestContext,
  requestObservability,
  writeLog,
};

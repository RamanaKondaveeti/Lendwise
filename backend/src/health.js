const { logError } = require('./logger');

function createHealthHandlers({ checkDatabase, logger = logError }) {
  return {
    live(_req, res) {
      return res.status(200).json({ ok: true });
    },
    async ready(_req, res) {
      try {
        await checkDatabase();
        return res.status(200).json({ ok: true });
      } catch (error) {
        logger('database_readiness_failed', error);
        return res.status(503).json({ ok: false });
      }
    },
  };
}

module.exports = { createHealthHandlers };

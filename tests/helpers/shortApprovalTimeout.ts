// Imported first by tests that need unapproved calls to expire quickly. It must
// run before anything calls getEnv(), which caches the environment (the logger
// does so at import time).
process.env['APPROVAL_TIMEOUT_SECONDS'] = '1'

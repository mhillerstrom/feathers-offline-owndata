
const BaseEngine = require('./commons/base-engine');

const makeDebug = require('debug');
const debug = makeDebug('realtime-engine');

module.exports = class RealtimeEngine extends BaseEngine {
  constructor (service, options = {}) {
    debug('constructor started');

    super(service, options);

    debug('constructor ended');
  }
};

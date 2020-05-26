
const BaseReplicator = require('./commons/base-replicator');
const RealtimeEngine = require('./realtime-engine');

const makeDebug = require('debug');
const debug = makeDebug('realtime-replicator');

module.exports = class RealtimeReplicator extends BaseReplicator {
  constructor (service, options = {}) {
    debug('constructor started');
    super(service, options);

    const engine = this.engine = new RealtimeEngine(service, options);
    this.changeSort = (...args) => engine.changeSort(...args);
    this.on = (...args) => engine.on(...args);
    this.store = engine.store;

    debug('constructor ended');
  }
};

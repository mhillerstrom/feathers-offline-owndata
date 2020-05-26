
const snapshot = require('feathers-offline-snapshot');
const { genUuid } = require('./utils');

const makeDebug = require('debug');
const debug = makeDebug('base-replicator');

module.exports = class BaseReplicator {
  constructor (service, options = {}) {
    debug('constructor entered');

    // Higher order class defines: this.engine, this.store, this.changeSort, this.on

    this._service = service;
    this._query = options.query || {};
    this._publication = options.publication;

    this.genShortUuid = true;
  }

  get connected () {
    return this.engine.listening;
  }

  connect () {
    this.engine.removeListeners();

    let query = this._query;

    if (this.engine.useUpdatedAt) {
      // We want to sync records since last sync (or last acknowledged online change)
      query = Object.assign({}, this._query, { updatedAt: { $gte: new Date(this.engine.store.syncedAt) } });
    }

    return snapshot(this._service, query)
      .then(records => {
        records = this._publication ? records.filter(this._publication) : records;
        records = this.engine.sorter ? records.sort(this.engine.sorter) : records;

        this.engine.snapshot(records);
        this.engine.processQueuedEvents()
          .catch(err => console.error(`PROCESS_QUEUED_EVENTS ERROR ${JSON.stringify(err)}`));
        this.engine.addListeners();
      });
  }

  disconnect () {
    this.engine.removeListeners();
  }

  useShortUuid (ifShortUuid) {
    this.genShortUuid = !!ifShortUuid;
  }

  getUuid () {
    return genUuid(this.genShortUuid);
  }

  // array.sort(Realtime.sort('fieldName'));
  static sort (prop) {
    return (a, b) => a[prop] > b[prop] ? 1 : (a[prop] < b[prop] ? -1 : 0);
  }

  // array.sort(Realtime.multiSort({ field1: 1, field2: -1 }))
  static multiSort (order) {
    const props = Object.keys(order);
    const len = props.length;

    return (a, b) => {
      let result = 0;
      let i = 0;

      while (result === 0 && i < len) {
        const prop = props[i];
        const sense = order[prop];

        result = a[prop] > b[prop] ? 1 * sense : (a[prop] < b[prop] ? -1 * sense : 0);
        i++;
      }

      return result;
    };
  }
};

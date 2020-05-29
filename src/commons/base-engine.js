
const errors = require('@feathersjs/errors');
const EventEmitter = require('component-emitter');
const makeDebug = require('debug');
const debug = makeDebug('base-engine');

const DOB = '2020-05-26T00:00:00.001Z';

module.exports = class BaseEngine {
  constructor (service, options = {}) {
    debug('constructor entered');

    this._service = service;
    this._publication = options.publication;
    this._subscriber = options.subscriber || (() => {});
    this._sorter = options.sort;
    this._eventEmitter = new EventEmitter();

    this._listener = eventName => remoteRecord => this._mutateStore(
      eventName, remoteRecord, 0
    );

    this._eventListeners = {
      created: this._listener('created'),
      updated: this._listener('updated'),
      patched: this._listener('patched'),
      removed: this._listener('removed')
    };

    this.useUuid = options.uuid;
    this.useUpdatedAt = options.updatedAt;
    this.emit = this._eventEmitter.emit;
    this.on = this._eventEmitter.on;
    this.listening = false;

    this.store = {
      syncedAt: DOB,
      last: { eventName: '', action: '', record: {} },
      records: [],
      queued: [] // Storage for queued mutations (mutations done while offline)
    };
  }

  snapshot (records) {
    debug('snapshot entered');

    this.store.last = { action: 'snapshot' };
    this.store.records = records;

    // Determine latest update
    let updatedAt = DOB;
    records.forEach(rec => { updatedAt = (rec.updatedAt > updatedAt) ? rec.updatedAt : updatedAt; });
    this.store.syncedAt = updatedAt;

    if (this._sorter) {
      records.sort(this._sorter);
    }

    this.emit('events', this.store.records, this.store.last);
    this._subscriber(this.store.records, this.store.last);
  }

  async processQueuedEvents () {
    debug('processQueuedEvents entered');

    let stop = false;
    while (this.store.queued.length && !stop) {
      const el = this.store.queued.shift();
      const event = el.eventName;

      // remove _fail and _timeout from query
      for (const i in el.args) {
        if (el.args[i].query) {
          delete el.args[i].query._fail;
          delete el.args[i].query._timeout;
        }
      }
      await this._service[event](el.args[0], el.args[1], el.args[2])
        .catch(() => { this.store.queued.unshift(el); stop = true; });
    }
    return true;
  }

  _addQueuedEvent (eventName, localRecord, ...args) {
    debug('addQueuedEvent entered');

    this.store.queued.push({ eventName, record: localRecord, args: { ...args } });
  }

  _addQueuedNetEvent (eventName, localRecord, ...args) {
    debug('addQueuedNetEvent entered');

    if (this.store.queued.length) {
      const idName = ('id' in localRecord ? 'id' : '_id');
      const index = this._findIndexReversed(this.store.queued, qElement => qElement.record[idName] === localRecord[idName]);

      if (index > -1) { // We only record net changes...
        if (this.store.queued[index].event !== 'remove') {
          this.store.queued[index].record = Object.assign({}, this.store.queued[index].record, localRecord);
          this.store.queued[index].eventName = eventName;
          this.store.queued[index].args = { ...args };
        } else { // This is a very unlikely scenario as uuid's generally speaking are unique
          if (eventName !== 'create') throw new errors.BadRequest(`Impossible queue event (remove followed by ${eventName})`);

          this.store.queued.splice(index + 1, 0, { eventName, record: localRecord, args: { ...args } });
        }
      } else {
        this._addQueuedEvent(eventName, localRecord, ...args);
      }
    } else {
      this._addQueuedEvent(eventName, localRecord, ...args);
    }
  }

  _removeQueuedEvent (eventName, localRecord, updatedAt) {
    debug('removeQueuedEvent entered');

    const idName = this._useUuid ? 'uuid' : ('id' in localRecord ? 'id' : '_id');
    const index = this._findIndexReversed(this.store.queued, qElement => qElement.record[idName] === localRecord[idName] && qElement.eventName === eventName);

    if (index >= 0) {
      this.store.queued.splice(index, 1);
    }
    if (updatedAt) this.store.syncedAt = updatedAt;
  }

  _removeQueuedNetEvent (eventName, localRecord, updatedAt) {
    debug('removeQueuedNetEvent entered');

    if (this.store.queued.length) {
      const idName = ('id' in localRecord ? 'id' : '_id');
      let index = this._findIndexReversed(this.store.queued, qElement => qElement.record[idName] === localRecord[idName]);
      if (index >= 0) {
        this.store.queued.splice(index, 1);
      }

      // We might have a remove followed by create (but it is very unlikely)
      index = this._findIndexReversed(this.store.queued, qElement => qElement.record[idName] === localRecord[idName]);
      if (index >= 0) {
        this.store.queued.splice(index, 1);
      }
    }

    if (updatedAt) this.store.syncedAt = updatedAt;
  }

  addListeners () {
    debug('addListeners entered');
    const service = this._service;
    const eventListeners = this._eventListeners;

    service.on('created', eventListeners.created);
    service.on('updated', eventListeners.updated);
    service.on('patched', eventListeners.patched);
    service.on('removed', eventListeners.removed);

    this.listening = true;
    this.emit('events', this.store.records, { action: 'add-listeners' });
    this._subscriber(this.store.records, { action: 'add-listeners' });
  }

  removeListeners () {
    debug('removeListeners entered');

    if (this.listening) {
      const service = this._service;
      const eventListeners = this._eventListeners;

      service.removeListener('created', eventListeners.created);
      service.removeListener('updated', eventListeners.updated);
      service.removeListener('patched', eventListeners.patched);
      service.removeListener('removed', eventListeners.removed);

      this.listening = false;
      this.emit('events', this.store.records, { action: 'remove-listeners' });
      this._subscriber(this.store.records, { action: 'remove-listeners' });
    }
  }

  _mutateStore (eventName, remoteRecord, source) {
    debug(`_mutateStore started: ${eventName}`);
    const that = this;

    const idName = 'id' in remoteRecord ? 'id' : '_id';
    const store = this.store;
    const records = store.records;
    let beforeRecord = null;

    const index = this._findIndex(records, record => record[idName] === remoteRecord[idName]);

    if (index >= 0) {
      beforeRecord = records[index];
      records.splice(index, 1);
    }

    if (eventName === 'removed') {
      if (index >= 0) {
        broadcast('remove');
      } else if (source === 0 && (!this._publication || this._publication(remoteRecord))) {
        // Emit service event if it corresponds to a previous optimistic remove
        broadcast('remove');
      }

      return beforeRecord; // index >= 0 ? broadcast('remove') : undefined;
    }

    if (this._publication && !this._publication(remoteRecord)) {
      return index >= 0 ? broadcast('left-pub') : undefined;
    }

    remoteRecord.updatedAt = new Date();
    records[records.length] = remoteRecord;

    if (this._sorter) {
      records.sort(this._sorter);
    }

    broadcast('mutated');

    return remoteRecord;

    function broadcast (action) {
      debug(`emitted ${index} ${eventName} ${action}`);
      store.last = { source, action, eventName, record: remoteRecord };

      that.emit('events', records, store.last);
      that._subscriber(records, store.last);
    }
  }

  changeSort (sort) {
    this._sorter = sort;

    if (this._sorter) {
      this.store.records.sort(this._sorter);
    }

    this.emit('events', this.store.records, { action: 'change-sort' });
    this._subscriber(this.store.records, { action: 'change-sort' });
  }

  _findIndex (array, predicate = () => true, fromIndex = 0) {
    for (let i = fromIndex, len = array.length; i < len; i++) {
      if (predicate(array[i])) {
        return i;
      }
    }

    return -1;
  }

  _findIndexReversed (array, predicate = () => true, fromIndex = Number.POSITIVE_INFINITY) {
    fromIndex = Math.min(fromIndex, array.length - 1);
    for (let i = fromIndex; i > -1; i--) {
      if (predicate(array[i])) {
        return i;
      }
    }

    return -1;
  }
};

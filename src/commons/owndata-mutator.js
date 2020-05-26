/*
 Forked from feathers-memory/src/index.js
 */
const errors = require('@feathersjs/errors');
const { _ } = require('@feathersjs/commons');
const { sorter, select, AdapterService } = require('@feathersjs/adapter-commons');
const sift = require('sift').default;
const { timeLimit } = require('./utils/');
const makeDebug = require('debug');
const debug = makeDebug('owndata-mutator');

const _select = (data, ...args) => {
  const base = select(...args);

  return base(JSON.parse(JSON.stringify(data)));
};

class Service extends AdapterService {
  constructor (options = {}) {
    super(_.extend({
      id: 'id',
      matcher: sift,
      sorter
    }, options));
    this._uId = options.startId || 0;
    this.store = options.store || {};

    this._replicator = options.replicator;
    this._engine = this._replicator.engine;
    const timeout = options.timeout || 2500; // defaults to 2.5 seconds
    this.timeout = timeout;

    if (!this._engine.useUuid) {
      throw new Error('Replicator must be configured for uuid for optimistic updates. (owndata)');
    }

    if (!this._engine.useUpdatedAt) {
      throw new Error('Replicator must be configured for updatedAt for optimistic updates. (owndata)');
    }

    this._mutateStore = this._engine._mutateStore.bind(this._engine);
    this._addQueuedEvent = this._engine._addQueuedEvent.bind(this._engine);
    this._removeQueuedEvent = this._engine._removeQueuedEvent.bind(this._engine);
    this._alwaysSelect = ['id', '_id', 'uuid'];
    this._getUuid = this._replicator.getUuid;

    this.store = this._engine.store || { records: [] };
    this.paginate = options.paginate || {};

    // We need time-limited versions of the remote service methods
    const ctx = this._replicator._service;
    this.remoteCreate = timeLimit(ctx.create, ctx, timeout);
    this.remotePatch = timeLimit(ctx.patch, ctx, timeout);
    this.remoteUpdate = timeLimit(ctx.update, ctx, timeout);
    this.remoteRemove = timeLimit(ctx.remove, ctx, timeout);
  }

  async getEntries (params = {}) {
    const { query } = this.filterQuery(params);

    return this._find(Object.assign({}, params, {
      paginate: false,
      query
    }));
  }

  async _find (params = {}) {
    const { query, filters, paginate } = this.filterQuery(params);
    let values = _.values(this.store.records).filter(this.options.matcher(query));
    const total = values.length;

    if (filters.$sort !== undefined) {
      values.sort(this.options.sorter(filters.$sort));
    }

    if (filters.$skip !== undefined) {
      values = values.slice(filters.$skip);
    }

    if (filters.$limit !== undefined) {
      values = values.slice(0, filters.$limit);
    }

    const result = {
      total,
      limit: filters.$limit,
      skip: filters.$skip || 0,
      data: values.map(value => _select(value, params))
    };

    if (!(paginate && paginate.default)) {
      return result.data;
    }

    return result;
  }

  async _get (uuid, params = {}) {
    const records = this.store.records;
    const index = findUuidIndex(records, uuid);

    if (index === -1) {
      return Promise.reject(new errors.NotFound(`No record found for uuid '${uuid}'`));
    }

    return Promise.resolve(records[index])
      .then(select(params, ...this._alwaysSelect));
  }

  // Create without hooks and mixins that can be used internally
  async _create (data, params = {}) {
    if (Array.isArray(data)) {
      return Promise.all(data.map(current => this._create(current, params)));
    }

    this._checkConnected();

    if (!('uuid' in data)) {
      data.uuid = this._getUuid();
    }

    const records = this.store.records;
    const index = findUuidIndex(records, data.uuid);
    if (index > -1) {
      throw new errors.BadRequest('Optimistic create requires unique uuid. (owndata)');
    }

    // optimistic mutation
    const newData = this._mutateStore('created', data, 1);
    this._addQueuedEvent('create', newData, shallowClone(newData), params);

    // Start actual mutation on remote service
    this.remoteCreate(shallowClone(newData), params)
      .then(([err, res]) => {
        if (err) {
          if (err.timeout) {
            debug(`_create TIMEOUT: ${JSON.stringify(err)}`);
          } else {
            debug(`_create ERROR: ${JSON.stringify(err)}`);
          }
        }
        if (res) {
          this._removeQueuedEvent('create', newData, res.updatedAt);
        }
      })
      .catch(err => debug(`_create catch ERROR!!! ${JSON.stringify(err)}`));

    return Promise.resolve(newData)
      .then(select(params, ...this._alwaysSelect));
  }

  async _update (id, data, params = {}) {
    this._checkConnected();
    checkUuidExists(data);

    const records = this.store.records;
    const index = findIdIndex(records, id);
    if (index === -1) {
      return Promise.reject(new errors.NotFound(`No record found for id '${id}'`));
    }

    // We don't want our id to change type if it can be coerced
    const beforeRecord = shallowClone(records[index]);
    const beforeUuid = beforeRecord.uuid;
    data.uuid = beforeUuid; // eslint-disable-line

    // Optimistic mutation
    const newData = this._mutateStore('updated', data, 1);
    this._addQueuedEvent('update', newData, getId(newData), shallowClone(newData), params);

    // Start actual mutation on remote service
    this.remoteUpdate(getId(newData), shallowClone(newData), params)
      .then(([err, res]) => {
        if (err) {
          if (err.timeout) {
            debug(`_update TIMEOUT: ${JSON.stringify(err)}`);
          } else {
            debug(`_update ERROR: ${JSON.stringify(err)}`);
          }
        }
        if (res) {
          this._removeQueuedEvent('update', shallowClone(newData), res.updatedAt);
        }
      });
    return Promise.resolve(newData)
      .then(select(params, ...this._alwaysSelect));
  }

  async _patch (id, data, params = {}) {
    this._checkConnected();

    if (id === null) {
      return this._find(params).then(page => {
        const res = page.data ? page.data : page;
        return Promise.all(res.map(
          current => this._patch(current.id, data, params))
        );
      });
    }

    const records = this.store.records;
    const index = findIdIndex(records, id);
    if (index === -1) {
      return Promise.reject(new errors.NotFound(`No record found for id '${id}'`));
    }

    // Optimistic mutation
    const beforeRecord = shallowClone(records[index]);
    const afterRecord = Object.assign({}, beforeRecord, data);
    const newData = this._mutateStore('patched', afterRecord, 1);
    this._addQueuedEvent('patch', newData, getId(newData), shallowClone(newData), params);

    // Start actual mutation on remote service
    this.remotePatch(getId(newData), shallowClone(newData), params)
      .then(([err, res]) => {
        if (err) {
          if (err.timeout) {
            debug(`_patch TIMEOUT: ${JSON.stringify(err)}`);
          } else {
            debug(`_patch ERROR: ${JSON.stringify(err)}`);
          }
        }
        if (res) {
          this._removeQueuedEvent('patch', newData, res.updatedAt);
        }
      });

    return Promise.resolve(newData)
      .then(select(params, ...this._alwaysSelect));
  }

  // Remove without hooks and mixins that can be used internally
  async _remove (id, params = {}) {
    this._checkConnected();

    if (id === null) {
      return this._find(params).then(page => {
        const res = page.data ? page.data : page;
        return Promise.all(res.map(
          current => this._remove(current.id, params))
        );
      });
    }

    const records = this.store.records;
    const index = findIdIndex(records, id);
    if (index === -1) {
      return Promise.reject(new errors.NotFound(`No record found for id '${id}'`));
    }

    // Optimistic mutation
    const beforeRecord = shallowClone(records[index]);
    const newData = this._mutateStore('removed', beforeRecord, 1);
    this._addQueuedEvent('remove', beforeRecord, id, params);

    // Start actual mutation on remote service
    this.remoteRemove(id, params)
      .then(([err, res]) => {
        if (err) {
          if (err.timeout) {
            debug(`_remove TIMEOUT: ${JSON.stringify(err)}`);
          } else {
            debug(`_remove ERROR: ${JSON.stringify(err)}`);
          }
        }
        if (res) {
          this._removeQueuedEvent('remove', beforeRecord, null);
        }
      });

    return Promise.resolve(newData)
      .then(select(params, ...this._alwaysSelect));
  }

  _checkConnected () {
    if (!this._replicator.connected) {
      throw new errors.BadRequest('Replicator not connected to remote. (owndata)');
    }
  }
}

function init (options) {
  return new Service(options);
}
init.Service = Service;

module.exports = init;

// Helpers

function findIdIndex (array, id) {
  for (let i = 0, len = array.length; i < len; i++) {
    if (array[i].id == id || array[i]._id == id) { // eslint-disable-line
      return i;
    }
  }

  return -1;
}

function findUuidIndex (array, uuid) {
  for (let i = 0, len = array.length; i < len; i++) {
    if (array[i].uuid == uuid) { // eslint-disable-line
      return i;
    }
  }

  return -1;
}

function checkUuidExists (record) {
  if (!('uuid' in record)) {
    throw new errors.BadRequest('Optimistic mutation requires uuid. (owndata)');
  }
}

function getId (record) {
  return ('id' in record ? record.id : record._id);
}

function shallowClone (obj) {
  return Object.assign({}, obj);
}

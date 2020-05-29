const assert = require('chai').assert;
const feathers = require('@feathersjs/feathers');
const memory = require('feathers-memory');
const errors = require('@feathersjs/errors');
const { setNow } = require('feathers-hooks-common');
const ownnetMutator = require('../../../src/ownnet-mutator');
const _ = require('lodash');
const { omit, remove } = _;

const sampleLen = 5; // Size of test database (backend)
const verbose = false; // Should the test be chatty?
const timeout = 400; // How patient should the client be?
const serverTimeout = 5000; // The default Feathers backend timeout

let app;
let clientService;

function services1 () {
  app = this;

  app.configure(fromServiceNonPaginatedConfig);
}

async function getRows (service) {
  let gRows = null;
  gRows = await service.find({ query: { id: { $gte: 0 }, $sort: { uuid: 1 } } });
  return gRows;
}

/**
 * This sets up a before ans error hook for all functions for a given service. The hook
 * can simulate e.g. backend failure by supplying {query: {_fail:true}} to the
 * calls or network connection trouble by supplying {query: {_fail:true, _timeout: true}}.
 * If _fail is false or the query is not supplied all this hook is bypassed.
 *
 * @param {string} type Typically 'Remote' or 'Client'
 * @param {*} service The service to be hooked into
 * @param {*} allowFail Will we allow the usage of _fail and _timeout?
 */
function setUpHooks (type, service, allowFail = false) {
  async function runTimer (context) {
    if (verbose) {
      console.time(`${type}.${context.method}.hook timing`);
      console.log(`timeout set to: client: ${timeout}, server: ${serverTimeout}`);
    }
    await new Promise(resolve => setTimeout(resolve, serverTimeout, true))
      .then(res => {
        if (verbose) {
          console.log(`${type}.${context.method}.hook (timeout triggered) res = ${res}`);
          console.timeEnd(`${type}.${context.method}.hook timing`);
        }
      });
  }

  app.service(service).hooks({
    before: {
      all: async context => {
        if (verbose) {
          const data = context.data ? `\n\tdata\t${JSON.stringify(context.data)}` : '';
          const params = context.params ? `\n\tparams\t${JSON.stringify(context.params)}` : '';
          console.log(`Before.all.hook ${type}.${context.method} called${data}${params}`);
        }
        if (allowFail && context.params.query && context.params.query._fail) { // Passing in param _fail simulates errors
          if (context.params.query._timeout) {
            await runTimer(context)
              .then(() => {
                throw new errors.BadRequest(`Fail requested (timeout=${serverTimeout})`);
              });
          } else { throw new errors.BadRequest('Fail requested (timeout=na)'); }

          const tout = context.params.query._timeout ? context.params.query._timeout : 'na';
          throw new errors.BadRequest(`Fail requested (timeout=${tout})`);
        }
      },
      create: [
        setNow('updatedAt')
      ],
      update: [
        setNow('updatedAt')
      ],
      patch: [
        setNow('updatedAt')
      ]

    },
    error: {
      all: context => {
        if (verbose) {
          console.log(`Error.all.hook ${type}.${context.method} ERROR ${JSON.stringify(context.error)}`);
        }
      }
    }
  });
}

function fromServiceNonPaginatedConfig () {
  const app = this;

  app.use('/from', memory({ multi: true }));
  setUpHooks('REMOTE', 'from', true);
}

module.exports = function (Replicator, desc) {
  describe(`${desc} - optimistic mutation online`, () => {
    let data;
    let fromService;
    let replicator;

    beforeEach(() => {
      const app = feathers()
        .configure(services1);

      fromService = app.service('from');

      const updatedAt = new Date();
      data = [];
      for (let i = 0, len = sampleLen; i < len; i += 1) {
        data.push({ id: i, uuid: 1000 + i, order: i, updatedAt });
      }
    });

    describe('not connected', () => {
      let events;

      beforeEach(() => {
        events = [];

        return fromService.create(clone(data))
          .then(() => {
            replicator = new Replicator(fromService, { sort: Replicator.sort('order'), uuid: true, updatedAt: true });

            app.use('clientService', ownnetMutator({ replicator }));

            clientService = app.service('clientService');
            setUpHooks('CLIENT', 'clientService');

            replicator.on('events', (records, last) => {
              events[events.length] = last;
            });
          });
      });

      it('create fails', () => {
        return clientService.create({ id: 99, uuid: 1099, order: 99 }, { query: { _fail: true } })
          .then(() => {
            assert(false, 'Unexpectedly succeeded.');
          })
          .catch(err => {
            assert.equal(err.className, 'bad-request');
          });
      });
    });

    describe('without publication', () => {
      let events;

      beforeEach(() => {
        events = [];

        return fromService.create(clone(data))
          .then(() => {
            replicator = new Replicator(fromService, { sort: Replicator.sort('order'), uuid: true, updatedAt: true });

            app.use('clientService', ownnetMutator({ replicator }));

            clientService = app.service('clientService');

            replicator.on('events', (records, last) => {
              events[events.length] = last;
            });
          });
      });

      it('find works', () => {
        return replicator.connect()
          .then(() => clientService.find({ query: { order: { $lt: 3 } } }))
          .then(result => {
            const records = replicator.store.records;

            assertDeepEqualExcept(result, data.slice(0, 3), ['updatedAt']);
            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' }
            ], ['updatedAt']);

            assert.lengthOf(records, sampleLen);
            assertDeepEqualExcept(records, data, ['updatedAt']);
          })
          .then(() => replicator.disconnect());
      });

      it('get works', () => {
        return replicator.connect()
          .then(() => clientService.get(0))
          .then(result => {
            const records = replicator.store.records;

            assertDeepEqualExcept([result], [{ id: 0, uuid: 1000, order: 0 }], ['updatedAt']);
            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' }
            ], ['updatedAt']);

            assert.lengthOf(records, sampleLen);
            assertDeepEqualExcept(records, data, ['updatedAt']);
          })
          .then(() => replicator.disconnect());
      });

      it('create works', () => {
        return replicator.connect()
          .then(() => clientService.create({ id: 99, uuid: 1099, order: 99 }))
          .then(delay())
          .then(result => {
            const records = replicator.store.records;

            data[sampleLen] = { id: 99, uuid: 1099, order: 99 };

            assertDeepEqualExcept([result], [{ id: 99, uuid: 1099, order: 99 }], ['updatedAt']);
            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'created', action: 'mutated', record: { id: 99, uuid: 1099, order: 99 } },
              { source: 0, eventName: 'created', action: 'mutated', record: { id: 99, uuid: 1099, order: 99 } }
            ], ['updatedAt']);

            assert.lengthOf(records, sampleLen + 1);
            assertDeepEqualExcept(records, data, ['updatedAt']);
          })
          .then(() => replicator.disconnect());
      });

      it('create adds missing uuid', () => {
        return replicator.connect()
          .then(() => clientService.create({ id: 99, order: 99 }))
          .then(data => {
            assert.isString(data.uuid);
          })
          .then(() => replicator.disconnect());
      });

      it('update works', () => {
        return replicator.connect()
          .then(() => clientService.update(0, { id: 0, uuid: 1000, order: 99 }))
          .then(delay())
          .then(result => {
            const records = replicator.store.records;
            data.splice(0, 1);
            data[data.length] = { id: 0, uuid: 1000, order: 99 };

            assertDeepEqualExcept([result], [{ id: 0, uuid: 1000, order: 99 }], ['updatedAt']);
            assert.lengthOf(records, sampleLen);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'updated', action: 'mutated', record: { id: 0, uuid: 1000, order: 99 } },
              { source: 0, eventName: 'updated', action: 'mutated', record: { id: 0, uuid: 1000, order: 99 } }
            ], ['updatedAt']);
          });
      });

      it('patch works', () => {
        return replicator.connect()
          .then(() => clientService.patch(1, { order: 99 }))
          .then(delay())
          .then(result => {
            const records = replicator.store.records;
            data.splice(1, 1);
            data[data.length] = { id: 1, uuid: 1001, order: 99 };

            assertDeepEqualExcept([result], [{ id: 1, uuid: 1001, order: 99 }], ['updatedAt']);
            assert.lengthOf(records, sampleLen);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'patched', action: 'mutated', record: { id: 1, uuid: 1001, order: 99 } },
              { source: 0, eventName: 'patched', action: 'mutated', record: { id: 1, uuid: 1001, order: 99 } }
            ], ['updatedAt']);
          });
      });

      it('remove works', () => {
        return replicator.connect()
          .then(() => clientService.remove(2))
          .then(delay())
          .then(result => {
            const records = replicator.store.records;
            data.splice(2, 1);

            assertDeepEqualExcept([result], [{ id: 2, uuid: 1002, order: 2 }], ['updatedAt']);
            assert.lengthOf(records, sampleLen - 1);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'removed', action: 'remove', record: { id: 2, uuid: 1002, order: 2 } },
              { source: 0, eventName: 'removed', action: 'remove', record: { id: 2, uuid: 1002, order: 2 } }
            ], ['updatedAt']);
          });
      });
    });

    describe('without publication, null id', () => {
      let events;

      beforeEach(() => {
        events = [];

        return fromService.create(clone(data))
          .then(() => {
            replicator = new Replicator(fromService, { sort: Replicator.sort('order'), uuid: true, updatedAt: true });

            app.use('clientService', ownnetMutator({ replicator, multi: true }));

            clientService = app.service('clientService');

            replicator.on('events', (records, last) => {
              events[events.length] = last;
            });
          });
      });

      it('create works', () => {
        return replicator.connect()
          .then(() => clientService.create([
            { id: 98, uuid: 1098, order: 98 },
            { id: 99, uuid: 1099, order: 99 }
          ]))
          .then(delay())
          .then(result => {
            const records = replicator.store.records;

            data[sampleLen] = { id: 98, uuid: 1098, order: 98 };
            data[sampleLen + 1] = { id: 99, uuid: 1099, order: 99 };

            assertDeepEqualExcept(result, [
              { id: 98, uuid: 1098, order: 98 },
              { id: 99, uuid: 1099, order: 99 }
            ], ['updatedAt']);
            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'created', action: 'mutated', record: { id: 98, uuid: 1098, order: 98 } },
              { source: 1, eventName: 'created', action: 'mutated', record: { id: 99, uuid: 1099, order: 99 } },
              { source: 0, eventName: 'created', action: 'mutated', record: { id: 98, uuid: 1098, order: 98 } },
              { source: 0, eventName: 'created', action: 'mutated', record: { id: 99, uuid: 1099, order: 99 } }
            ], ['updatedAt']);

            assert.lengthOf(records, sampleLen + 2);
            assertDeepEqualExcept(records, data, ['updatedAt']);
          })
          .then(() => replicator.disconnect());
      });

      it('patch works', () => {
        return replicator.connect()
          .then(() => clientService.patch(null, { foo: 1 }, { query: { order: { $gt: 0, $lt: 4 } } }))
          .then(delay())
          .then(result => {
            const records = replicator.store.records;

            data[1].foo = 1;
            data[2].foo = 1;
            data[3].foo = 1;

            assertDeepEqualExcept(result, [
              { id: 1, uuid: 1001, order: 1, foo: 1 },
              { id: 2, uuid: 1002, order: 2, foo: 1 },
              { id: 3, uuid: 1003, order: 3, foo: 1 }
            ], ['updatedAt']);

            assert.lengthOf(records, sampleLen);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'patched', action: 'mutated', record: { id: 1, uuid: 1001, order: 1, foo: 1 } },
              { source: 1, eventName: 'patched', action: 'mutated', record: { id: 2, uuid: 1002, order: 2, foo: 1 } },
              { source: 1, eventName: 'patched', action: 'mutated', record: { id: 3, uuid: 1003, order: 3, foo: 1 } },
              { source: 0, eventName: 'patched', action: 'mutated', record: { id: 1, uuid: 1001, order: 1, foo: 1 } },
              { source: 0, eventName: 'patched', action: 'mutated', record: { id: 2, uuid: 1002, order: 2, foo: 1 } },
              { source: 0, eventName: 'patched', action: 'mutated', record: { id: 3, uuid: 1003, order: 3, foo: 1 } }
            ], ['updatedAt']);
          });
      });

      it('remove works', () => {
        return replicator.connect()
          .then(() => clientService.remove(null, { query: { order: { $gt: 0, $lt: 4 } } }))
          .then(delay())
          .then(result => {
            const records = replicator.store.records;
            data.splice(1, 3);

            assertDeepEqualExcept(result, [
              { id: 1, uuid: 1001, order: 1 },
              { id: 2, uuid: 1002, order: 2 },
              { id: 3, uuid: 1003, order: 3 }
            ], ['updatedAt']);

            assert.lengthOf(records, sampleLen - 3);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'removed', action: 'remove', record: { id: 1, uuid: 1001, order: 1 } },
              { source: 1, eventName: 'removed', action: 'remove', record: { id: 2, uuid: 1002, order: 2 } },
              { source: 1, eventName: 'removed', action: 'remove', record: { id: 3, uuid: 1003, order: 3 } },
              { source: 0, eventName: 'removed', action: 'remove', record: { id: 1, uuid: 1001, order: 1 } },
              { source: 0, eventName: 'removed', action: 'remove', record: { id: 2, uuid: 1002, order: 2 } },
              { source: 0, eventName: 'removed', action: 'remove', record: { id: 3, uuid: 1003, order: 3 } }
            ], ['updatedAt']);
          });
      });
    });

    describe('without publication & remote error (timeout)', () => {
      let events;

      beforeEach(() => {
        events = [];
        return fromService.create(clone(data))
          .then(() => {
            replicator = new Replicator(fromService, { sort: Replicator.sort('order'), uuid: true, updatedAt: true });

            app.use('clientService', ownnetMutator({ replicator, timeout }));

            clientService = app.service('clientService');

            replicator.on('events', (records, last) => {
              events[events.length] = last;
            });
          });
      });

      it('get fails correctly', () => {
        return replicator.connect()
          .then(() => clientService.get(9999))
          .then(() => {
            assert(false, 'Unexpectedly succeeded');
          })
          .catch(err => {
            assert.equal(err.className, 'not-found');
          })
          .then(() => replicator.disconnect());
      });

      // TODO: Test two clients updating data to same 'from' and later synchronizing - newest change wins!

      it('create works and sync recovers', () => {
        let clientRows = null;

        return replicator.connect()
          .then(() => clientService.create({ id: 99, uuid: 1099, order: 99 }, { query: { _fail: true, _timeout: true } }))
          .then(delay())
          // Current client side store status
          .then(() => getRows(clientService))
          .then(delay())
          .then(rows => { clientRows = rows; })
          .then(() => {
            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'created', action: 'mutated', record: { id: 99, uuid: 1099, order: 99 } }
            ], ['updatedAt']);

            data[sampleLen] = { id: 99, uuid: 1099, order: 99 };

            assert.lengthOf(clientRows, sampleLen + 1);
            assertDeepEqualExcept(clientRows, data, ['updatedAt']);
          })
          .then(() => replicator.connect())
          .then(delay(20))
        // See changes after synchronization
          .then(() => getRows(fromService))
          .then(delay())
          .then(fromRows => {
            // Make sure remote data has changed...
            assert.lengthOf(fromRows, sampleLen + 1);
            assertDeepEqualExcept(fromRows, clientRows, ['updatedAt']);
          })
          .then(() => replicator.disconnect());
      });

      it('update works and sync recovers', () => {
        let clientRows = null;

        return replicator.connect()
          .then(() => clientService.update(0, { id: 0, uuid: 1000, order: 99 }, { query: { _fail: true, _timeout: true } }))
          .then(delay())
          .then(() => {
            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'updated', action: 'mutated', record: { id: 0, uuid: 1000, order: 99 } }
            ], ['updatedAt']);
          })
        // We have simulated offline - make sure remote data has not yet changed...
          .then(() => getRows(fromService))
          .then(delay())
          .then(fromRows => {
            assert.lengthOf(fromRows, sampleLen);
            assertDeepEqualExcept(fromRows, data, ['updatedAt']);
          })
        // Current client side store status
          .then(() => getRows(clientService))
          .then(delay())
          .then(rows => { clientRows = rows; })
          .then(() => replicator.connect())
          .then(delay(20))
        // See changes after synchronization
          .then(() => getRows(fromService))
          .then(delay())
          .then(fromRows => {
            // Make sure remote data has changed...
            assert.lengthOf(fromRows, sampleLen);
            assertDeepEqualExcept(fromRows, clientRows, ['updatedAt']);
          })
          .then(() => replicator.disconnect());
      });

      it('patch works and sync recovers', () => {
        let clientRows = null;

        return replicator.connect()
          .then(() => clientService.patch(1, { order: 99 }, { query: { _fail: true, _timeout: true } }))
          .then(delay())
          // Current client side store status
          .then(() => getRows(clientService))
          .then(delay())
          .then(rows => { clientRows = rows; })
          .then(() => {
            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'patched', action: 'mutated', record: { id: 1, uuid: 1001, order: 99 } }
            ], ['updatedAt']);

            assert.lengthOf(clientRows, sampleLen);
          })
        // We have simulated offline - make sure remote data has not yet changed...
          .then(() => getRows(fromService))
          .then(delay())
          .then(fromRows => {
            assert.lengthOf(fromRows, sampleLen);
            assertDeepEqualExcept(fromRows, data, ['updatedAt']);
          })
          .then(() => replicator.connect())
          .then(delay(20))
        // See changes after synchronization
          .then(() => getRows(fromService))
          .then(delay())
          .then(fromRows => {
            // Make sure remote data has changed...
            assert.lengthOf(fromRows, sampleLen);
            assertDeepEqualExcept(fromRows, clientRows, ['updatedAt']);
          })
          .then(() => replicator.disconnect());
      });

      it('remove works and sync recovers', () => {
        let clientRows = null;

        return replicator.connect()
          .then(() => clientService.remove(2, { query: { _fail: true, _timeout: true } }))
          .then(delay())
          .then(() => {
            const records = replicator.store.records;

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'removed', action: 'remove', record: { id: 2, uuid: 1002, order: 2 } }
            ], ['updatedAt']);
            assert.lengthOf(records, sampleLen - 1);

            // Remove uuid=1002 (id=2) from sample data
            let newData = JSON.parse(JSON.stringify(data));
            newData = remove(newData, (val, ix, arr) => val.id !== 2);

            assertDeepEqualExcept(records, newData, ['updatedAt']);
          })
        // We have simulated offline - make sure remote data has not yet changed...
          .then(() => getRows(fromService))
          .then(delay())
          .then(fromRows => {
            assert.lengthOf(fromRows, sampleLen);
            assertDeepEqualExcept(fromRows, data, ['updatedAt']);
          })
        // Current client side store status
          .then(() => getRows(clientService))
          .then(delay())
          .then(rows => { clientRows = rows; })
          .then(() => replicator.connect())
          .then(delay(20))
        // See changes after synchronization
          .then(() => getRows(fromService))
          .then(delay())
          .then(fromRows => {
            // Make sure remote data has changed...
            assert.lengthOf(fromRows, sampleLen - 1);
            assertDeepEqualExcept(fromRows, clientRows, ['updatedAt']);
          })
          .then(() => replicator.disconnect());
      });
    });

    describe('test of sync', () => {
      let events;

      beforeEach(() => {
        events = [];
        return fromService.create(clone(data))
          .then(() => {
            replicator = new Replicator(fromService, { sort: Replicator.sort('order'), uuid: true, updatedAt: true });

            app.use('clientService', ownnetMutator({ replicator, timeout }));

            clientService = app.service('clientService');

            replicator.on('events', (records, last) => {
              events[events.length] = last;
            });
          });
      });

      it('sync net only', () => {
        let clientRows = null;
        let countEvents = 0;

        return replicator.connect()
          .then(() => clientService.update(0, { id: 0, uuid: 1000, order: 99 }, { query: { _fail: true, _timeout: true } }))
          .then(delay())
          .then(() => clientService.update(0, { id: 0, uuid: 1000, order: 999 }, { query: { _fail: true, _timeout: true } }))
          .then(delay())
          .then(() => clientService.update(0, { id: 0, uuid: 1000, order: 9999 }, { query: { _fail: true, _timeout: true } }))
          .then(delay())
          .then(() => {
            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 1, eventName: 'updated', action: 'mutated', record: { id: 0, uuid: 1000, order: 99 } },
              { source: 1, eventName: 'updated', action: 'mutated', record: { id: 0, uuid: 1000, order: 999 } },
              { source: 1, eventName: 'updated', action: 'mutated', record: { id: 0, uuid: 1000, order: 9999 } }
            ], ['updatedAt']);
          })
        // We have simulated offline - make sure remote data has not yet changed...
          .then(() => fromService.find({ query: { uuid: 1000 } }))
          .then(delay())
          .then(fromRows => {
            assertDeepEqualExcept(fromRows, [{ id: 0, uuid: 1000, order: 0 }], ['updatedAt']);
          })
        // Current client side store status
          .then(() => getRows(clientService))
          .then(delay())
          .then(rows => { clientRows = rows; })
          .then(() => {
            fromService.on('updated', () => {
              countEvents++;
            });
          })
          .then(() => replicator.connect())
          .then(delay(20))
        // See changes after synchronization
          .then(() => getRows(fromService))
          .then(delay())
          .then(fromRows => {
            // Make sure remote data has changed...
            assert.lengthOf(clientRows, sampleLen);
            assert.equal(countEvents, 1);
            assert.lengthOf(fromRows, sampleLen);
            assertDeepEqualExcept(fromRows, clientRows, ['updatedAt']);
          })
          .then(() => replicator.disconnect());
      });
    });
  });
};

// Helpers

function clone (obj) {
  return JSON.parse(JSON.stringify(obj));
}

function delay (ms = 0) {
  return data => new Promise(resolve => {
    setTimeout(() => {
      resolve(data);
    }, ms);
  });
}

function assertDeepEqualExcept (ds1, ds2, ignore) {
  function removeIgnore (ds) {
    let dsc = clone(ds);
    dsc = omit(dsc, ignore);
    for (const i in dsc) {
      if (typeof dsc[i] === 'object') {
        dsc[i] = removeIgnore(dsc[i]);
      }
    }
    return dsc;
  }

  assert.isArray(ds1);
  assert.isArray(ds2);
  assert.isArray(ignore);
  assert.equal(ds1.length, ds2.length);
  for (let i = 0; i < ds1.length; i++) {
    const dsi1 = removeIgnore(ds1[i]);
    const dsi2 = removeIgnore(ds2[i]);
    assert.deepEqual(dsi1, dsi2);
  }
}

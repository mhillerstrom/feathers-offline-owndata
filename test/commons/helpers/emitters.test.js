
const assert = require('chai').assert;
const feathers = require('@feathersjs/feathers');
const memory = require('feathers-memory');
const _ = require('lodash');
const { omit } = _;

const sampleLen = 5;

let app;

function services1 () {
  const app = this;

  app.configure(fromServiceNonPaginatedConfig);
}

function fromServiceNonPaginatedConfig () {
  const app = this;

  app.use('/from', memory({ multi: true }));
}

module.exports = function (Replicator, desc) {
  describe(`${desc} - emitters`, () => {
    let data;
    let fromService;
    let replicator;

    beforeEach(() => {
      app = feathers()
        .configure(services1);

      fromService = app.service('from');

      data = [];
      for (let i = 0, len = sampleLen; i < len; i += 1) {
        data.push({ id: i, uuid: 1000 + i, order: i });
      }
    });

    describe('without publication', () => {
      let events;

      beforeEach(() => {
        events = [];

        return fromService.create(clone(data))
          .then(() => {
            replicator = new Replicator(fromService, {
              sort: Replicator.sort('order')
            });
            replicator.on('events', (records, last) => {
              events[events.length] = last;
            });
          });
      });

      it('create works', () => {
        return replicator.connect()
          .then(() => fromService.create({ id: 99, uuid: 1099, order: 99 }))
          .then(() => replicator.disconnect())
          .then(() => {
            const records = replicator.store.records;
            data[sampleLen] = { id: 99, uuid: 1099, order: 99 };

            assert.lengthOf(records, sampleLen + 1);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 0, eventName: 'created', action: 'mutated', record: { id: 99, uuid: 1099, order: 99 } },
              { action: 'remove-listeners' }
            ], ['updatedAt']);
          });
      });

      it('update works', () => {
        return replicator.connect()
          .then(() => fromService.update(0, { id: 0, uuid: 1000, order: 99 }))
          .then(() => {
            const records = replicator.store.records;
            data.splice(0, 1);
            data[data.length] = { id: 0, uuid: 1000, order: 99 };

            assert.lengthOf(records, sampleLen);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 0, eventName: 'updated', action: 'mutated', record: { id: 0, uuid: 1000, order: 99 } }
            ], ['updatedAt']);
          });
      });

      it('patch works', () => {
        return replicator.connect()
          .then(() => fromService.patch(1, { order: 99 }))
          .then(() => {
            const records = replicator.store.records;
            data.splice(1, 1);
            data[data.length] = { id: 1, uuid: 1001, order: 99 };

            assert.lengthOf(records, sampleLen);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 0, eventName: 'patched', action: 'mutated', record: { id: 1, uuid: 1001, order: 99 } }
            ], ['updatedAt']);
          });
      });

      it('remove works', () => {
        return replicator.connect()
          .then(() => fromService.remove(2))
          .then(() => {
            const records = replicator.store.records;
            data.splice(2, 1);

            assert.lengthOf(records, sampleLen - 1);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 0, eventName: 'removed', action: 'remove', record: { id: 2, uuid: 1002, order: 2 } }
            ], ['updatedAt']);
          });
      });
    });

    describe('within publication', () => {
      const testLen = 4;
      let events;

      beforeEach(() => {
        events = [];

        return fromService.create(clone(data))
          .then(() => {
            replicator = new Replicator(fromService, {
              sort: Replicator.sort('order'),
              publication: record => record.order <= 3.5
            });

            data.splice(testLen);

            replicator.on('events', (records, last) => {
              events[events.length] = last;
            });
          });
      });

      it('create works', () => {
        return replicator.connect()
          .then(() => fromService.create({ id: 99, uuid: 1099, order: 3.5 }))
          .then(() => {
            const records = replicator.store.records;
            data[testLen] = { id: 99, uuid: 1099, order: 3.5 };

            assert.lengthOf(records, testLen + 1);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 0, eventName: 'created', action: 'mutated', record: { id: 99, uuid: 1099, order: 3.5 } }
            ], ['updatedAt']);
          });
      });
    });

    describe('outside publication', () => {
      const testLen = 4;
      let events;

      beforeEach(() => {
        events = [];

        return fromService.create(clone(data))
          .then(() => {
            replicator = new Replicator(fromService, {
              sort: Replicator.sort('order'),
              publication: record => record.order <= 3.5
            });

            data.splice(testLen);

            replicator.on('events', (records, last) => {
              events[events.length] = last;
            });
          });
      });

      it('create works', () => {
        return replicator.connect()
          .then(() => fromService.create({ id: 99, uuid: 1099, order: 99 }))
          .then(() => {
            const records = replicator.store.records;

            assert.lengthOf(records, testLen);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' }
            ], ['updatedAt']);
          });
      });
    });

    describe('moving in/out publication', () => {
      const testLen = 4;
      let events;

      beforeEach(() => {
        events = [];

        return fromService.create(clone(data))
          .then(() => {
            replicator = new Replicator(fromService, {
              sort: Replicator.sort('order'),
              publication: record => record.order <= 3.5
            });

            data.splice(testLen);

            replicator.on('events', (records, last) => {
              events[events.length] = last;
            });
          });
      });

      it('patching to without', () => {
        return replicator.connect()
          .then(() => fromService.patch(1, { order: 99 }))
          .then(() => {
            const records = replicator.store.records;
            data.splice(1, 1);

            assert.lengthOf(records, testLen - 1);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 0, eventName: 'patched', action: 'left-pub', record: { id: 1, uuid: 1001, order: 99 } }
            ], ['updatedAt']);
          });
      });

      it('patching to within', () => {
        return replicator.connect()
          .then(() => fromService.patch(4, { order: 3.5 }))
          .then(() => {
            const records = replicator.store.records;
            data[testLen] = { id: 4, uuid: 1004, order: 3.5 };

            assert.lengthOf(records, testLen + 1);
            assertDeepEqualExcept(records, data, ['updatedAt']);

            assertDeepEqualExcept(events, [
              { action: 'snapshot' },
              { action: 'add-listeners' },
              { source: 0, eventName: 'patched', action: 'mutated', record: { id: 4, uuid: 1004, order: 3.5 } }
            ], ['updatedAt']);
          });
      });
    });
  });
};

// Helpers

function clone (obj) {
  return JSON.parse(JSON.stringify(obj));
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

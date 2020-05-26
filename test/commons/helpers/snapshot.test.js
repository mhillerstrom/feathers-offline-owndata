
const assert = require('chai').assert;
const feathers = require('@feathersjs/feathers');
const memory = require('feathers-memory');

const sampleLen = 25;

let app;
let data;
let fromService;
let fromServicePaginated;

function services1 () {
  const app = this;

  app.configure(fromServiceNonPaginatedConfig);
  app.configure(fromServicePaginatedConfig);
}

function fromServiceNonPaginatedConfig () {
  const app = this;

  app.use('/from', memory({ multi: true }));
}

function fromServicePaginatedConfig () {
  const app = this;

  app.use('/frompaginated', memory({
    multi: true,
    paginate: {
      default: 2,
      max: 3
    }
  }));
}

module.exports = function (Replicator, desc) {
  describe(`${desc} - snapshot`, () => {
    describe('sorts', () => {
      let dataOrder;
      let dataId;
      let dataIdOrder;
      let dataIdXOrder;

      beforeEach(() => {
        data = [
          { id: 'q', order: 5 },
          { id: 'a', order: 9 },
          { id: 'z', order: 1 },
          { id: 'q', order: 3 }
        ];

        dataOrder = [
          { id: 'z', order: 1 },
          { id: 'q', order: 3 },
          { id: 'q', order: 5 },
          { id: 'a', order: 9 }
        ];

        dataId = [
          { id: 'a', order: 9 },
          { id: 'q', order: 5 },
          { id: 'q', order: 3 },
          { id: 'z', order: 1 }
        ];

        dataIdOrder = [
          { id: 'a', order: 9 },
          { id: 'q', order: 3 },
          { id: 'q', order: 5 },
          { id: 'z', order: 1 }
        ];

        dataIdXOrder = [
          { id: 'z', order: 1 },
          { id: 'q', order: 3 },
          { id: 'q', order: 5 },
          { id: 'a', order: 9 }
        ];
      });

      it('single sort works', () => {
        assert.deepEqual(data.sort(Replicator.sort('order')), dataOrder);
      });

      it('single sort is stable', () => {
        assert.deepEqual(data.sort(Replicator.sort('id')), dataId);
      });

      it('multiple sort works', () => {
        assert.deepEqual(data.sort(Replicator.multiSort({ id: 1, order: 1 })), dataIdOrder);
      });

      it('multiple sort order works', () => {
        assert.deepEqual(data.sort(Replicator.multiSort({ id: -1, order: 1 })), dataIdXOrder);
      });
    });

    describe('snapshot', () => {
      beforeEach(() => {
        app = feathers()
          .configure(services1);

        fromService = app.service('from');
        fromServicePaginated = app.service('frompaginated');

        data = [];
        for (let i = 0, len = sampleLen; i < len; i += 1) {
          data.push({ id: i, order: i });
        }

        return Promise.all([
          fromService.create(data),
          fromServicePaginated.create(data)
        ]);
      });

      it('non-paginated file', () => {
        const replicator = new Replicator(fromService);

        assert.equal(replicator.connected, false);

        return replicator.connect()
          .then(() => {
            const records = replicator.store.records;
            assert.lengthOf(records, sampleLen);

            assert.deepEqual(records.sort(Replicator.sort('order')), data);

            assert.equal(replicator.connected, true);
          });
      });

      it('paginated file', () => {
        const replicator = new Replicator(fromServicePaginated);

        return replicator.connect()
          .then(() => {
            const records = replicator.store.records;
            assert.lengthOf(records, sampleLen);

            assert.deepEqual(records.sort(Replicator.sort('order')), data);
          });
      });

      it('query works', () => {
        const query = { order: { $lt: 15 } };
        const replicator = new Replicator(fromServicePaginated, { query });

        return replicator.connect()
          .then(() => {
            const records = replicator.store.records;
            assert.lengthOf(records, 15);

            assert.deepEqual(records.sort(Replicator.sort('order')), data.slice(0, 15));
          });
      });

      it('publication works', () => {
        const query = { order: { $lt: 15 } };
        const publication = record => record.order < 10;
        const replicator = new Replicator(fromService, { query, publication });

        return replicator.connect()
          .then(() => {
            const records = replicator.store.records;
            assert.lengthOf(records, 10);

            assert.deepEqual(records.sort(Replicator.sort('order')), data.slice(0, 10));
          });
      });

      it('sort works', () => {
        const query = { order: { $lt: 15 } };
        const publication = record => record.order < 10;
        const replicator = new Replicator(fromService, {
          query, publication, sort: Replicator.sort('order')
        });

        return replicator.connect()
          .then(() => {
            const records = replicator.store.records;
            assert.lengthOf(records, 10);

            assert.deepEqual(records, data.slice(0, 10));
          });
      });

      it('change sort works', () => {
        const query = { order: { $lt: 15 } };
        const publication = record => record.order < 10;
        const replicator = new Replicator(fromService, {
          query, publication, sort: Replicator.sort('order')
        });

        return replicator.connect()
          .then(() => {
            replicator.changeSort(Replicator.multiSort({ id: -1 }));

            const records = replicator.store.records;
            assert.lengthOf(records, 10);

            assert.deepEqual(records, data.slice(0, 10).sort(
              (a, b) => a.id > b.id ? -1 : (a.id < b.id ? 1 : 0)
            ));
          });
      });
    });
  });
};

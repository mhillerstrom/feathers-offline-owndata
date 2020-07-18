# feathers-offline-owndata

[![Build Status](https://travis-ci.org/feathersjs/feathers-offline-owndata.png?branch=master)](https://travis-ci.org/feathersjs/feathers-offline-owndata)
[![Code Climate](https://codeclimate.com/github/feathersjs/feathers-offline-owndata/badges/gpa.svg)](https://codeclimate.com/github/feathersjs/feathers-offline-owndata)
[![Test Coverage](https://codeclimate.com/github/feathersjs/feathers-offline-owndata/badges/coverage.svg)](https://codeclimate.com/github/feathersjs/feathers-offline-owndata/coverage)
[![Dependency Status](https://img.shields.io/david/feathersjs/feathers-offline-owndata.svg?style=flat-square)](https://david-dm.org/feathersjs/feathers-offline-owndata)
[![Download Status](https://img.shields.io/npm/dm/feathers-offline-owndata.svg?style=flat-square)](https://www.npmjs.com/package/feathers-offline-owndata)

> Offline-first own-data/own-net replication with optimistic updates.

## Things needing FeathersJS-group attention
As I'm new at this many details are somewhat of a mystery. I've taken the `feathers-memory` adapter as my template. but please take a look at
   - all the links above 
   - `webpack.config.js` and verify its sanity
   - the `types` directory probably needs a lot of attention


> I have a sample Quasar-Cordova-FeathersJS-MongoDB [app](https://github.com/mhillerstrom/Quasar-Cordova) showcasing `feathers-offline-owndata`. It's still not complete, but it will show offline ability.

## Installation

```
npm install feathers-offline-owndata --save
```


## Documentation

You can read the docs [here](https://docs.feathersjs.com/guides/offline-first/readme.html).

For both principles you must assure that the table (or collection) under own-data/own-net control *must* implement both `uuid` and `updatedAt` attributes.

> **Pro tip:** If your key is not `uuid` then you have to manually set the key *before* calling `create` as you have no guarantee that the backend answers.

> **Pro tip:** If you want the back-end to hold all users' data in one table (or collection), then all rows (or documents) must include a user identification (e.g. '`_id`' of `users`) and an appropriate query should be set in the `options` parameter when registering the replicator (e.g. `{query: {userId: <whatever-the-value-is>}}`).

Also, updates from a requested sync will not execute any hooks but any queued events on the device will (both on back-end and on any other devices if you have implemented client-side hooks).

### When to use which principle?

### Things to consider


### The own-data principle implementation

There are multiple situations to consider

Situation | Client unit | Back-end
| --- | --- | --- |
|  |   | The back-end holds (multiple) users' data in same storage (the shared truth)
| Joins for first time | request sync from before app was born | deliver all relevant records |
| Joins after first time | request sync from newest `updatedAt` from latest sync | deliver all relevant records |
| Changes data (online) | change local data immediately | | |
| | record and send change to back-end | change relevant data and acknowledge | |
| | remove record of change | | |
| Changes data (offline) | change local data immediately |  |
| | queue mutation on device |  |
| Reconnects (online) | request sync from newest `updatedAt` from latest sync | deliver all relevant records |
| | send relevant (i.e. `updatedAt` newer on device or removed after `updatedAt`) queued mutations in order to back-end | change relevant data |
| | | (relevant hooks executes for each change) |


### The own-net principle implementation

Again, there are multiple situations to consider

Situation | Client unit | Back-end
| --- | --- | --- |
|  |   | The back-end holds multiple users' data in same storage (the shared truth)
| Joins for first time | request sync from before app was born | deliver all relevant records |
| Joins after first time | request sync from newest `updatedAt` from latest sync | deliver all relevant records |
| Changes data (online) | change local data immediately | | |
| | record and send change to back-end. If data item already is in queue, alter it to reflect result | change relevant data and acknowledge | |
| | remove change from queue |  | |
| Changes data (offline) | change local data immediately |  |
| | queue mutation on device. If data item already is in queue, alter it to reflect result |  |
| Reconnects (online) | request sync from newest `updatedAt` from latest sync | deliver all relevant records |
| | send relevant (i.e. `updatedAt` newer on device or removed after `updatedAt`) queued mutations in order to back-end | change relevant data |
| | | (relevant hooks executes for each net change) |


## License

Copyright (c) 2020

Licensed under the [MIT license](LICENSE).

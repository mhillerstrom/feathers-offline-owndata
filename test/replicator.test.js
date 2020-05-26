
const test = require('./commons/helpers/replicator.test.js');
const Owndata = require('../src');

test(Owndata, 'owndata', false);
test(Owndata, 'owndata', true);
